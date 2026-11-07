#!/usr/bin/env python3
"""在原位替换 Windows exe 的图标和版本信息字符串（不改变文件结构）。
用法：pe_patch.py <exe> <icon.png 256x256>
"""
import struct, sys, io
from PIL import Image

exe, icon_png = sys.argv[1], sys.argv[2]
buf = bytearray(open(exe, 'rb').read())

pe = struct.unpack_from('<I', buf, 0x3c)[0]
assert buf[pe:pe + 4] == b'PE\0\0'
nsec = struct.unpack_from('<H', buf, pe + 6)[0]
optsz = struct.unpack_from('<H', buf, pe + 20)[0]
opt = pe + 24
magic = struct.unpack_from('<H', buf, opt)[0]
dd = opt + (112 if magic == 0x20b else 96)
rsrc_rva, rsrc_size = struct.unpack_from('<II', buf, dd + 2 * 8)
secs = []
for i in range(nsec):
    o = opt + optsz + i * 40
    va, vsz, rawp = struct.unpack_from('<I', buf, o + 12)[0], struct.unpack_from('<I', buf, o + 8)[0], struct.unpack_from('<I', buf, o + 20)[0]
    secs.append((va, vsz, rawp))
def off(rva):
    for va, vsz, rawp in secs:
        if va <= rva < va + vsz: return rva - va + rawp
    raise ValueError(hex(rva))
base = off(rsrc_rva)

def entries(dir_off):
    nn, ni = struct.unpack_from('<HH', buf, dir_off + 12)
    for k in range(nn + ni):
        name, data = struct.unpack_from('<II', buf, dir_off + 16 + k * 8)
        yield name, data
def walk_type(t):
    out = {}
    for name, data in entries(base):
        if name == t and data & 0x80000000:
            for n2, d2 in entries(base + (data & 0x7fffffff)):
                for n3, d3 in entries(base + (d2 & 0x7fffffff)):
                    de = base + d3
                    rva, size = struct.unpack_from('<II', buf, de)
                    out[n2] = (de, rva, size)
                    break
    return out

icons = walk_type(3)
groups = walk_type(14)
src = Image.open(icon_png).convert('RGBA')

def dib(w):
    im = src.resize((w, w), Image.LANCZOS)
    px = im.tobytes('raw', 'BGRA')
    rows = [px[(w - 1 - y) * w * 4:(w - y) * w * 4] for y in range(w)]  # 自下而上
    mask_row = ((w + 31) // 32) * 4
    hdr = struct.pack('<IiiHHIIiiII', 40, w, w * 2, 1, 32, 0, w * w * 4 + mask_row * w, 0, 0, 0, 0)
    return hdr + b''.join(rows) + b'\0' * (mask_row * w)
def png(w, colors=None):
    im = src.resize((w, w), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, 'PNG', optimize=True); return b.getvalue()

changed = 0
for gid, (gde, grva, gsize) in groups.items():
    g = off(grva)
    _, typ, cnt = struct.unpack_from('<HHH', buf, g)
    for k in range(cnt):
        e = g + 6 + k * 14
        w, h, colors, _, planes, bpp, nbytes, iid = struct.unpack_from('<BBBBHHIH', buf, e)
        if iid not in icons: continue
        de, rva, size = icons[iid]
        W = w or 256
        old = bytes(buf[off(rva):off(rva) + 8])
        data = png(W) if (old.startswith(b'\x89PNG') or W >= 256) else dib(W)
        if len(data) > size:
            data = png(W)
        if len(data) > size:
            print('跳过（空间不够）', W, len(data), size); continue
        o = off(rva)
        buf[o:o + size] = data + b'\0' * (size - len(data))
        struct.pack_into('<I', buf, de + 4, len(data))
        struct.pack_into('<HHI', buf, e + 4, 1, 32, len(data))
        changed += 1
print('替换图标', changed, '个尺寸')

# ---- 版本信息：整块重建，写到旧图标腾出的空间里 ----
VER = sys.argv[3] if len(sys.argv) > 3 else '0.1.0'
INFO = {
    'CompanyName': 'chen-qingfeng',
    'FileDescription': 'Lightning Peek',
    'FileVersion': VER,
    'InternalName': 'LightningPeek',
    'LegalCopyright': 'Copyright (C) 2026 chen-qingfeng. GPL-3.0-or-later.',
    'OriginalFilename': 'LightningPeek.exe',
    'ProductName': 'Lightning Peek',
    'ProductVersion': VER,
}
def pad4(b): return b + b'\0' * ((-len(b)) % 4)
def node(key, value=b'', text=False, children=()):
    """VS_VERSIONINFO 通用节点：头 6 字节 + 键（UTF-16，含结尾 0）+ 对齐 + 值 + 对齐后的子节点"""
    d = bytearray(6) + (key + '\0').encode('utf-16le')
    d += b'\0' * ((-len(d)) % 4)
    d += value
    for c in children:
        d += b'\0' * ((-len(d)) % 4)
        d += c
    vlen = (len(value) // 2) if text else len(value)
    struct.pack_into('<HHH', d, 0, len(d), vlen, 1 if text else 0)
    return bytes(d)
def string(k, v): return node(k, (v + '\0').encode('utf-16le'), text=True)
ver = walk_type(16)
vid, (vde, vrva, vsize) = next(iter(ver.items()))
old = bytes(buf[off(vrva):off(vrva) + vsize])
ffi = old[old.find(struct.pack('<I', 0xFEEF04BD)):][:52]
ffi = bytearray(ffi)
maj, mnr, pat = (list(map(int, VER.split('-')[0].split('.'))) + [0, 0, 0])[:3]
struct.pack_into('<IIII', ffi, 8, (maj << 16) | mnr, pat << 16, (maj << 16) | mnr, pat << 16)
table = node('040904b0', children=[string(k, v) for k, v in INFO.items()], text=True)
sfi = node('StringFileInfo', children=[table], text=True)
vfi = node('VarFileInfo', children=[node('Translation', struct.pack('<HH', 0x0409, 0x04b0))], text=True)
root = node('VS_VERSION_INFO', bytes(ffi), children=[sfi, vfi])
blob = pad4(root)
# 找最大的图标数据块（已替换为更小的 PNG），把版本信息放在它的空闲尾部
best = None
for iid, (de, rva, size) in icons.items():
    used = struct.unpack_from('<I', buf, de + 4)[0]
    free = size - ((used + 15) // 16 * 16)
    if free >= len(blob) and (best is None or free > best[2]): best = (rva + (used + 15) // 16 * 16, de, free)
if best:
    nrva = best[0]; o = off(nrva)
    buf[o:o + len(blob)] = blob
    struct.pack_into('<II', buf, vde, nrva, len(blob))
    print('版本信息已重建', len(blob), '字节', INFO['FileDescription'], VER)
else:
    print('没有足够空间重建版本信息，保留原样')

open(exe, 'wb').write(buf)
