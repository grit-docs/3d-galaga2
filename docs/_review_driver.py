"""Background CDP driver for 3D Galaga 2 review.

Protocol:
- command file: docs/_review_cmd.json  {"seq": int, "op": ..., ...}
- result file:  docs/_review_result.json {"seq": int, "ok": bool, "data": any, "error": str?}
- console log:  docs/_review_console.jsonl (one JSON per event)

Ops:
  js        {expr}
  keydown   {code, key, autoRepeat?}
  keyup     {code, key}
  mouse     {type: mouseMoved|mousePressed|mouseReleased, x, y, button?}
  shot      {n} -> save screenshot to docs/_review_shot_{n}.png
  sleep     {ms}
  get_console -> returns and clears console buffer
"""
import asyncio, json, os, sys, time, contextlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _review_cdp_helper import CDP, list_targets

BASE = os.path.dirname(os.path.abspath(__file__))
CMD = os.path.join(BASE, "_review_cmd.json")
RES = os.path.join(BASE, "_review_result.json")
CON = os.path.join(BASE, "_review_console.jsonl")

def find_target():
    for t in list_targets():
        if t.get("type") == "page" and "localhost:5173" in (t.get("url") or ""):
            return t
    return None

def write_result(seq, ok, data=None, error=None):
    with open(RES, "w", encoding="utf-8") as f:
        json.dump({"seq": seq, "ok": ok, "data": data, "error": error}, f, ensure_ascii=False, default=str)

def read_cmd():
    try:
        with open(CMD, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None

def append_console(entry):
    with open(CON, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False, default=str) + "\n")

async def main():
    target = None
    for _ in range(60):
        target = find_target()
        if target:
            break
        await asyncio.sleep(1)
    if not target:
        print("FATAL: no 3d-galaga page target found", flush=True)
        sys.exit(1)
    cdp = CDP(target["webSocketDebuggerUrl"])
    await cdp.connect()
    print("DRIVER: attached to", target["url"], flush=True)
    open(CON, "w").close()
    last_console_sync = 0.0

    while True:
        cmd = read_cmd()
        if cmd is not None:
            seq = cmd.get("seq")
            op = cmd.get("op")
            try:
                if op == "js":
                    data = await cdp.js(cmd["expr"], timeout=cmd.get("timeout", 30))
                    write_result(seq, True, data=data)
                elif op == "keydown":
                    await cdp.key(cmd["code"], cmd["key"], down=True,
                                  auto_repeat=cmd.get("autoRepeat", False))
                    write_result(seq, True)
                elif op == "keyup":
                    await cdp.key(cmd["code"], cmd["key"], down=False)
                    write_result(seq, True)
                elif op == "mouse":
                    params = {"type": cmd["type"], "x": cmd["x"], "y": cmd["y"]}
                    if cmd.get("button"):
                        params["button"] = cmd["button"]
                        params["clickCount"] = 1
                    await cdp.send("Input.dispatchMouseEvent", params)
                    write_result(seq, True)
                elif op == "shot":
                    r = await cdp.send("Page.captureScreenshot", {"format": "png"})
                    import base64
                    p = os.path.join(BASE, f"_review_shot_{cmd.get('n', 0)}.png")
                    with open(p, "wb") as f:
                        f.write(base64.b64decode(r["result"]["data"]))
                    write_result(seq, True, data=p)
                elif op == "sleep":
                    await asyncio.sleep(cmd.get("ms", 100) / 1000.0)
                    write_result(seq, True)
                elif op == "get_console":
                    # return and clear in-memory buffer, also flush to file
                    out = cdp.console[:]
                    cdp.console.clear()
                    exc = cdp.exceptions[:]
                    cdp.exceptions.clear()
                    for c in out:
                        append_console(c)
                    write_result(seq, True, data={"console": out, "exceptions": exc})
                else:
                    write_result(seq, False, error=f"unknown op {op}")
            except Exception as e:
                write_result(seq, False, error=f"{type(e).__name__}: {e}")
            os.remove(CMD)
            last_console_sync = time.time()
        else:
            # periodically flush console to file so it's safe even if we crash
            if time.time() - last_console_sync > 5:
                for c in cdp.console:
                    append_console(c)
                cdp.console.clear()
                last_console_sync = time.time()
            await asyncio.sleep(0.05)

if __name__ == "__main__":
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(main())
