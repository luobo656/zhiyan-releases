"""ZY-Connect Python SDK: standard-library-only, loopback API, persisted outbox.

Use only when the producer has finished writing its video.
No social platform login or publishing controls are exposed.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import threading
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, quote
from urllib.request import Request, urlopen
from uuid import uuid4

FIELDS = {"contentId", "videoPath", "title", "description", "hashtags", "coverPath",
          "portraitCoverPath", "landscapeCoverPath", "collectionName", "publishAt", "metadata"}
MEDIA = ("videoPath", "coverPath", "portraitCoverPath", "landscapeCoverPath")


def _local_url(value):
    url = urlsplit(value)
    if (url.scheme not in ("http", "https") or
        url.hostname not in ("127.0.0.1", "localhost", "::1") or
        url.path not in ("", "/") or url.query or url.fragment or
        url.username or url.password):
        raise ValueError("Only a local loopback Zhiyan gateway is supported")
    return url.scheme + "://" + url.netloc


def _atomic(file, item):
    file.parent.mkdir(parents=True, exist_ok=True)
    tmp = file.with_name(file.name + "." + uuid4().hex + ".tmp")
    try:
        with tmp.open("x", encoding="utf8") as handle:
            json.dump(item, handle, ensure_ascii=False)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            tmp.chmod(0o600)
        except OSError:
            pass
        os.replace(tmp, file)
    finally:
        tmp.unlink(missing_ok=True)


def _read(file):
    try:
        return json.loads(file.read_text(encoding="utf8"))
    except FileNotFoundError:
        return None


def _visible(item):
    return {name: item.get(name) for name in
            ("contentId", "state", "deliveryId", "lastError", "attemptCount")}


def _key(s):
    return hashlib.sha256(s.encode("utf8")).hexdigest()


class ZyConnect:
    def __init__(self, output_dir, gateway_url="http://127.0.0.1:17351", state_dir=None):
        self.root = Path(output_dir).resolve(strict=True)
        if not self.root.is_dir():
            raise ValueError("output_dir must be a folder")
        self.gateway = _local_url(gateway_url)
        base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / ".local" / "share"))
        self.state = (Path(state_dir) if state_dir else
                      base / "Zhiyan" / "ZyConnect" / "python" /
                      _key(str(self.root).lower())[:24]).resolve()
        self.authfile = self.state / "credential.json"
        self.items = self.state / "items"
        self.media = self.root / ".zy-connect-outbox" / "python"
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.retry_thread = None

    def _request(self, route, body, token=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        req = Request(self.gateway + route, method="POST", headers=headers,
                      data=json.dumps(body, ensure_ascii=False).encode("utf8"))
        try:
            with urlopen(req, timeout=15) as response:
                return response.status, json.load(response)
        except HTTPError as e:
            return e.code, {}

    def _rows(self):
        return [_read(file) for file in self.items.glob("*.json")] if self.items.exists() else []

    def status(self):
        auth = _read(self.authfile) or {}
        items = self._rows()
        return {"paired": bool(auth.get("token")),
                "connectionName": auth.get("connectionName"),
                "pending": sum(i["state"] == "pending" for i in items),
                "blocked": sum(i["state"] == "blocked" for i in items),
                "acknowledged": sum(i["state"] == "acknowledged" for i in items)}

    def pair(self):
        with self.lock:
            old = _read(self.authfile)
            if old and old.get("token"):
                return {"paired": True, "connectionName": old.get("connectionName")}
            infofile = self.root / ".zhiyan" / "pairing.json"
            info = _read(infofile)
            if not info or info.get("kind") != "zhiyan-local-pairing" or info.get("schemaVersion") != 1:
                raise RuntimeError("请先在纸燕准备 API 配对")
            try:
                expiry = datetime.fromisoformat(info.get("expiresAt", "").replace("Z", "+00:00"))
            except ValueError as e:
                raise RuntimeError("配对信息无效") from e
            if expiry <= datetime.now(timezone.utc) or _local_url(info.get("gatewayUrl", "")) != self.gateway:
                raise RuntimeError("配对已过期或地址不符，请在纸燕重新准备")
            code, response = self._request("/v1/producer-pairings/exchange",
                                           {"code": info.get("code"), "label": info.get("connectionName", "")})
            if code != 201 or not response.get("connectionId") or not response.get("credential", {}).get("token"):
                raise RuntimeError("API 配对失败 HTTP " + str(code))
            _atomic(self.authfile, {"connectionId": response["connectionId"],
                                    "connectionName": response.get("connectionName", ""),
                                    "token": response["credential"]["token"], "gatewayUrl": self.gateway})
            infofile.unlink(missing_ok=True)
            return {"paired": True, "connectionName": response.get("connectionName")}

    def _itemfile(self, identifier):
        return self.items / (_key(identifier) + ".json")

    def _validate(self, content):
        if not isinstance(content, dict) or set(content) - FIELDS:
            raise ValueError("unsupported delivery fields")
        identifier = content.get("contentId")
        if not isinstance(identifier, str) or not identifier.strip() or len(identifier) > 256:
            raise ValueError("stable contentId required")
        if not isinstance(content.get("title"), str) or not content["title"].strip():
            raise ValueError("real title required")
        tags = content.get("hashtags")
        if tags is not None and (not isinstance(tags, list) or any(not isinstance(s, str) for s in tags)):
            raise ValueError("hashtags must be strings")
        result = dict(content)
        result["contentId"] = identifier.strip()
        for key in MEDIA:
            if not content.get(key):
                if key == "videoPath":
                    raise ValueError("videoPath required")
                continue
            file = Path(content[key]).resolve(strict=True)
            if not file.is_file() or self.root not in file.parents:
                raise ValueError("media path outside output directory")
            result[key] = str(file)
        return result

    def _enqueue(self, content):
        existing = _read(self._itemfile(content.get("contentId", "")))
        if existing:
            return existing
        data = self._validate(content)
        directory = self.media / _key(data["contentId"])
        directory.mkdir(parents=True, exist_ok=True)
        staged = dict(data)
        for field in MEDIA:
            if not data.get(field):
                continue
            original = Path(data[field])
            target = directory / (field + original.suffix.lower())
            temp = target.with_name(target.name + "." + uuid4().hex + ".tmp")
            shutil.copy2(original, temp)
            os.replace(temp, target)
            staged[field] = str(target)
        item = {"contentId": data["contentId"], "payload": staged, "state": "pending",
                "deliveryId": None, "lastError": None, "attemptCount": 0, "nextAttemptAt": 0}
        _atomic(self._itemfile(data["contentId"]), item)
        return item

    def deliver(self, content):
        with self.lock:
            item = self._enqueue(content)
            if item["state"] == "acknowledged":
                return _visible(item)
            if not (_read(self.authfile) or {}).get("token"):
                try:
                    self.pair()
                except (RuntimeError, OSError, URLError) as e:
                    item["lastError"] = str(e)[:220]
                    _atomic(self._itemfile(item["contentId"]), item)
                    return _visible(item)
            self.flush()
            return _visible(_read(self._itemfile(item["contentId"])))

    def flush(self):
        with self.lock:
            auth = _read(self.authfile)
            if not auth or not auth.get("token") or _local_url(auth.get("gatewayUrl", "")) != self.gateway:
                return []
            result = []
            for item in self._rows():
                if item["state"] != "pending" or item.get("nextAttemptAt", 0) > time.time():
                    continue
                item["attemptCount"] += 1
                try:
                    code, response = self._request(
                        "/v1/producer-connections/" + quote(auth["connectionId"]) + "/deliveries",
                        item["payload"], token=auth["token"])
                    if code == 202 and response.get("accepted") and response.get("delivery", {}).get("id"):
                        item.update(state="acknowledged", deliveryId=response["delivery"]["id"],
                                    lastError=None, nextAttemptAt=0)
                    elif 400 <= code < 500 and code not in (408, 425, 429):
                        item.update(state="blocked", lastError="Gateway rejected HTTP " + str(code))
                    else:
                        raise RuntimeError("Gateway temporarily unavailable HTTP " + str(code))
                except (RuntimeError, URLError, OSError) as e:
                    item["lastError"] = str(e)[:220]
                    item["nextAttemptAt"] = time.time() + min(300, 2 ** min(item["attemptCount"] + 1, 8))
                _atomic(self._itemfile(item["contentId"]), item)
                if item["state"] == "acknowledged":
                    shutil.rmtree(self.media / _key(item["contentId"]), ignore_errors=True)
                result.append(_visible(item))
            return result

    def start_retry(self, every_seconds=5):
        if self.retry_thread and self.retry_thread.is_alive():
            return
        self.stop_event.clear()
        def worker():
            while not self.stop_event.wait(max(1, every_seconds)):
                try:
                    if not (_read(self.authfile) or {}).get("token"):
                        self.pair()
                    self.flush()
                except Exception:
                    pass
        self.retry_thread = threading.Thread(target=worker, name="ZY-Connect retry", daemon=True)
        self.retry_thread.start()

    def stop_retry(self):
        self.stop_event.set()
        if self.retry_thread:
            self.retry_thread.join(timeout=3)
            self.retry_thread = None