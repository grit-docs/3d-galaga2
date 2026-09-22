"""Async CDP websocket helper for E2E review (test-only, not part of build)."""
import asyncio, json, urllib.request, contextlib

PORT = 65405

def list_targets():
    return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=10).read())

def new_tab(url="about:blank"):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/json/new?{url}", method="PUT")
    return json.loads(urllib.request.urlopen(req, timeout=10).read())

class CDP:
    def __init__(self, ws_url):
        self.ws_url = ws_url
        self._id = 0
        self._futures = {}
        self.console = []       # (type, args)
        self.exceptions = []    # exception text
        self._ws = None
        self._task = None

    async def connect(self):
        import websockets
        self._ws = await websockets.connect(self.ws_url, max_size=200*1024*1024)
        self._task = asyncio.create_task(self._reader())
        await self.send("Runtime.enable")
        await self.send("Log.enable")
        await self.send("Page.enable")
        await self.send("Network.enable")
        return self

    async def _reader(self):
        import websockets
        try:
            async for raw in self._ws:
                msg = json.loads(raw)
                if "id" in msg and msg["id"] in self._futures:
                    fut = self._futures.pop(msg["id"])
                    fut.set_result(msg)
                    continue
                m = msg.get("method")
                p = msg.get("params", {})
                if m == "Runtime.consoleAPICalled":
                    args = p.get("args", [])
                    texts = []
                    for a in args:
                        if "value" in a:
                            texts.append(str(a["value"]))
                        elif a.get("type") == "string":
                            texts.append(a.get("value", ""))
                        elif a.get("type") == "object" and "description" in a:
                            texts.append(a["description"])
                        else:
                            texts.append(a.get("unserializableValue", ""))
                    self.console.append((p.get("type"), " | ".join(texts)))
                elif m == "Runtime.exceptionThrown":
                    d = p.get("exceptionDetails", {})
                    desc = d.get("exception", {}).get("description") or d.get("text", "")
                    self.exceptions.append(str(desc))
                elif m == "Log.entryAdded":
                    e = p.get("entry", {})
                    if e.get("level") in ("error", "warning"):
                        self.console.append((f"log:{e.get('level')}", e.get("text", "")))
        except websockets.ConnectionClosed:
            pass

    async def send(self, method, params=None, timeout=30):
        self._id += 1
        mid = self._id
        fut = asyncio.get_event_loop().create_future()
        self._futures[mid] = fut
        await self._ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        return await asyncio.wait_for(fut, timeout)

    async def js(self, expr, timeout=30):
        r = await self.send("Runtime.evaluate", {
            "expression": expr, "returnByValue": True, "awaitPromise": True}, timeout=timeout)
        res = r.get("result", {}).get("result", {})
        if "value" in res:
            return res["value"]
        if res.get("subtype") == "error" or "description" in res:
            return {"__error__": res.get("description") or res.get("value")}
        return res

    async def key(self, code, key, down=True, auto_repeat=False):
        params = {"type": "keyDown" if down else "keyUp", "code": code, "key": key,
                  "windowsVirtualKeyCode": 0, "nativeVirtualKeyCode": 0, "autoRepeat": auto_repeat}
        await self.send("Input.dispatchKeyEvent", params)

    async def press(self, code, key, hold_ms=0):
        await self.key(code, key, down=True)
        if hold_ms > 0:
            await asyncio.sleep(hold_ms/1000)
            for _ in range(hold_ms // 50):
                await self.key(code, key, down=True, auto_repeat=True)
                await asyncio.sleep(0.05)
        await self.key(code, key, down=False)

    async def mouse_move(self, x, y):
        await self.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y})

    async def mouse_down(self, x, y):
        await self.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y,
                                                     "button": "left", "clickCount": 1})

    async def mouse_up(self, x, y):
        await self.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y,
                                                     "button": "left", "clickCount": 1})

    async def click(self, x, y):
        await self.mouse_down(x, y)
        await asyncio.sleep(0.03)
        await self.mouse_up(x, y)

    async def wait_load(self, timeout=45):
        # poll document.readyState via js
        t0 = asyncio.get_event_loop().time()
        while asyncio.get_event_loop().time() - t0 < timeout:
            st = await self.js("document.readyState")
            if st == "complete":
                return True
            await asyncio.sleep(0.3)
        return False

    async def close(self):
        if self._task:
            self._task.cancel()
            with contextlib.suppress(Exception):
                await self._task
        if self._ws:
            with contextlib.suppress(Exception):
                await self._ws.close()
