"""Pretend X32 for testing: answers OSC queries from stored values, stores sets,
and logs every set so we can check what the app sent. UDP 127.0.0.1:10023."""
import socket, struct, sys

def pad(b):
    b += b"\0"
    return b + b"\0" * ((4 - len(b) % 4) % 4)

def enc(addr, val):
    if isinstance(val, int):
        return pad(addr.encode()) + pad(b",i") + struct.pack(">i", val)
    if isinstance(val, float):
        return pad(addr.encode()) + pad(b",f") + struct.pack(">f", val)
    return pad(addr.encode()) + pad(b",s") + pad(val.encode())

def rstr(b, p):
    e = b.index(b"\0", p)
    return b[p:e].decode(), (e + 4) & ~3

def dec(b):
    addr, p = rstr(b, 0)
    if p >= len(b):
        return addr, None
    tags, p = rstr(b, p)
    if tags == ",":
        return addr, None
    t = tags[1]
    if t == "i":
        return addr, struct.unpack(">i", b[p:p + 4])[0]
    if t == "f":
        return addr, struct.unpack(">f", b[p:p + 4])[0]
    return addr, rstr(b, p)[0]

state = {}
for c in range(1, 33):
    ch = f"/ch/{c:02d}"
    state.update({
        f"{ch}/mix/fader": 0.75, f"{ch}/mix/on": 1, f"{ch}/mix/pan": 0.5, f"{ch}/config/name": "",
        f"{ch}/preamp/hpon": 0, f"{ch}/preamp/hpf": 0.4, f"{ch}/eq/on": 1,
        f"{ch}/gate/on": 0, f"{ch}/gate/thr": 0.5, f"{ch}/gate/range": 0.5, f"{ch}/gate/attack": 0.1,
        f"{ch}/gate/hold": 0.5, f"{ch}/gate/release": 0.5,
        f"{ch}/dyn/on": 0, f"{ch}/dyn/thr": 0.66, f"{ch}/dyn/ratio": 5, f"{ch}/dyn/knee": 0.4,
        f"{ch}/dyn/mgain": 0.0, f"{ch}/dyn/attack": 0.1, f"{ch}/dyn/hold": 0.3, f"{ch}/dyn/release": 0.5,
    })
    for b, (t, f) in enumerate([(1, 0.25), (2, 0.45), (2, 0.65), (4, 0.85)], 1):
        state.update({f"{ch}/eq/{b}/type": t, f"{ch}/eq/{b}/f": f, f"{ch}/eq/{b}/g": 0.5, f"{ch}/eq/{b}/q": 0.46})
# A realistically set-up vocal on channel 1.
state.update({
    "/ch/01/config/name": "Pastor", "/ch/01/preamp/hpon": 1, "/ch/01/preamp/hpf": 0.5,
    "/ch/01/eq/2/g": 0.4, "/ch/01/eq/3/g": 0.6, "/ch/01/dyn/on": 1, "/ch/01/dyn/thr": 0.6,
    "/ch/01/gate/on": 1, "/ch/01/mix/fader": 0.6,
    "/ch/02/config/name": "Keys", "/ch/03/config/name": "Guitar", "/ch/04/config/name": "Kick", "/ch/04/mix/on": 0,
})

s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.bind(("127.0.0.1", 10023))
print("fake X32 listening", flush=True)
while True:
    data, peer = s.recvfrom(4096)
    try:
        addr, val = dec(data)
    except Exception:
        continue
    if addr == "/xremote":
        continue
    if val is None:
        if addr in state:
            s.sendto(enc(addr, state[addr]), peer)
    else:
        state[addr] = val
        print(f"SET {addr} {val}", flush=True)
        s.sendto(enc(addr, val), peer)  # echo like /xremote would
