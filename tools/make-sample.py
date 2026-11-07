#!/usr/bin/env python3
"""生成仓库自带的示例图纸（DXF R12，纯 ASCII + UTF-8 文字，任意 CAD 软件都能打开）。
  docs/samples/pump-room.dxf        泵房平面 A 版
  docs/samples/pump-room-rev-b.dxf  B 版：挪动一台泵、改一个编号、加一个阀门、删一段管线
用法：python3 tools/make-sample.py
"""
import math, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'docs', 'samples')


class Dxf:
    def __init__(self):
        self.ents, self.blocks = [], []

    @staticmethod
    def rec(kind, layer, pairs):
        out = [(0, kind), (8, layer)]
        out += pairs
        return out

    def line(self, layer, a, b, color=None):
        p = [(10, a[0]), (20, a[1]), (11, b[0]), (21, b[1])]
        if color: p = [(62, color)] + p
        self.ents.append(self.rec('LINE', layer, p))

    def poly(self, layer, pts, closed=True, width=0, target=None):
        t = target if target is not None else self.ents
        t.append(self.rec('POLYLINE', layer, [(66, 1), (10, 0), (20, 0), (70, 1 if closed else 0)] + ([(40, width), (41, width)] if width else [])))
        for x, y in pts:
            t.append(self.rec('VERTEX', layer, [(10, x), (20, y)]))
        t.append([(0, 'SEQEND'), (8, layer)])

    def rect(self, layer, x0, y0, x1, y1, target=None):
        self.poly(layer, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], True, target=target)

    def circle(self, layer, c, r, target=None):
        (target if target is not None else self.ents).append(self.rec('CIRCLE', layer, [(10, c[0]), (20, c[1]), (40, r)]))

    def arc(self, layer, c, r, a0, a1):
        self.ents.append(self.rec('ARC', layer, [(10, c[0]), (20, c[1]), (40, r), (50, a0), (51, a1)]))

    def solid(self, layer, x0, y0, x1, y1):
        self.ents.append(self.rec('SOLID', layer, [(10, x0), (20, y0), (11, x1), (21, y0), (12, x0), (22, y1), (13, x1), (23, y1)]))

    def text(self, layer, p, h, s, align=0, target=None):
        pairs = [(10, p[0]), (20, p[1]), (40, h), (1, s)]
        if align:
            pairs += [(72, align), (11, p[0]), (21, p[1])]
        (target if target is not None else self.ents).append(self.rec('TEXT', layer, pairs))

    def insert(self, layer, name, p, rot=0):
        self.ents.append(self.rec('INSERT', layer, [(2, name), (10, p[0]), (20, p[1]), (50, rot)]))

    def block(self, name, ents):
        self.blocks.append((name, ents))

    def write(self, path):
        L = []
        add = lambda c, v: L.extend([str(c), (f'{v:.6f}'.rstrip('0').rstrip('.') if isinstance(v, float) else str(v))])
        add(0, 'SECTION'); add(2, 'HEADER')
        add(9, '$ACADVER'); add(1, 'AC1009')
        add(9, '$INSUNITS'); add(70, 4)
        add(9, '$LTSCALE'); add(40, 20.0)
        add(9, '$DWGCODEPAGE'); add(3, 'ANSI_1252')
        add(0, 'ENDSEC')
        add(0, 'SECTION'); add(2, 'TABLES')
        add(0, 'TABLE'); add(2, 'LTYPE'); add(70, 2)
        for name, desc, dashes in [('CONTINUOUS', 'Solid line', []), ('CENTER', 'Center ____ _ ____', [31.75, -6.35, 6.35, -6.35])]:
            add(0, 'LTYPE'); add(2, name); add(70, 0); add(3, desc); add(72, 65); add(73, len(dashes)); add(40, float(sum(abs(d) for d in dashes)))
            for d in dashes: add(49, float(d))
        add(0, 'ENDTAB')
        layers = [('0', 7, 'CONTINUOUS'), ('AXIS', 1, 'CENTER'), ('WALL', 7, 'CONTINUOUS'), ('COLUMN', 8, 'CONTINUOUS'), ('DOOR', 3, 'CONTINUOUS'),
                  ('EQUIP', 2, 'CONTINUOUS'), ('PIPE', 4, 'CONTINUOUS'), ('DIM', 3, 'CONTINUOUS'), ('TEXT', 7, 'CONTINUOUS'), ('FRAME', 7, 'CONTINUOUS'), ('TABLE', 6, 'CONTINUOUS')]
        add(0, 'TABLE'); add(2, 'LAYER'); add(70, len(layers))
        for n, c, lt in layers:
            add(0, 'LAYER'); add(2, n); add(70, 0); add(62, c); add(6, lt)
        add(0, 'ENDTAB')
        add(0, 'ENDSEC')
        add(0, 'SECTION'); add(2, 'BLOCKS')
        for name, ents in self.blocks:
            add(0, 'BLOCK'); add(8, '0'); add(2, name); add(70, 0); add(10, 0.0); add(20, 0.0); add(30, 0.0); add(3, name)
            for e in ents:
                for c, v in e: add(c, v)
            add(0, 'ENDBLK'); add(8, '0')
        add(0, 'ENDSEC')
        add(0, 'SECTION'); add(2, 'ENTITIES')
        for e in self.ents:
            for c, v in e: add(c, v)
        add(0, 'ENDSEC'); add(0, 'EOF')
        with open(path, 'w', encoding='utf-8', newline='\r\n') as f:
            f.write('\n'.join(L) + '\n')


def build(rev_b=False):
    d = Dxf()
    # 图块：水泵（底座 + 泵壳 + 进出口）、阀门（蝶阀符号）
    pump = []
    d.rect('0', -600, -450, 600, 450, target=pump)
    d.circle('0', (0, 0), 320, target=pump)
    d.circle('0', (0, 0), 120, target=pump)
    pump.append(Dxf.rec('LINE', '0', [(10, -600), (20, 0), (11, -320), (21, 0)]))
    pump.append(Dxf.rec('LINE', '0', [(10, 320), (20, 0), (11, 600), (21, 0)]))
    d.block('PUMP', pump)
    valve = []
    d.poly('0', [(-150, -110), (150, 110), (150, -110), (-150, 110)], True, target=valve)
    valve.append(Dxf.rec('LINE', '0', [(10, 0), (20, 0), (11, 0), (21, 220)]))
    valve.append(Dxf.rec('LINE', '0', [(10, -90), (20, 220), (11, 90), (21, 220)]))
    d.block('VALVE', valve)

    W, H, T = 12000, 8000, 240
    # 轴网
    xs, ys = [0, 6000, 12000], [0, 8000]
    for i, x in enumerate(xs):
        d.line('AXIS', (x, -1800), (x, H + 1800))
        d.circle('AXIS', (x, H + 2200), 400); d.text('AXIS', (x, H + 2200), 400, str(i + 1), align=4)
    for j, y in enumerate(ys):
        d.line('AXIS', (-1800, y), (W + 1800, y))
        d.circle('AXIS', (-2200, y), 400); d.text('AXIS', (-2200, y), 400, 'AB'[j], align=4)
    # 墙体（内外两圈）与门洞
    d.poly('WALL', [(-T / 2, -T / 2), (W + T / 2, -T / 2), (W + T / 2, H + T / 2), (-T / 2, H + T / 2)])
    d.poly('WALL', [(T / 2, T / 2), (W - T / 2, T / 2), (W - T / 2, H - T / 2), (T / 2, H - T / 2)])
    # 柱子（实心填充）
    for x in xs:
        for y in ys:
            d.solid('COLUMN', x - 200, y - 200, x + 200, y + 200)
    # 门：墙上开 1200 宽门，门扇和开启弧
    d.line('DOOR', (1500, -T / 2), (1500, T / 2)); d.line('DOOR', (2700, -T / 2), (2700, T / 2))
    d.line('DOOR', (1500, T / 2), (1500, 1200 + T / 2)); d.arc('DOOR', (1500, T / 2), 1200, 0, 90)
    # 设备
    pumps = [(3000, 5200), (5200, 5200), (7400, 5200), (9600, 5200)]
    if rev_b: pumps[3] = (9600, 4700)
    for i, p in enumerate(pumps):
        d.insert('EQUIP', 'PUMP', p)
        label = f'P-{i + 1}' if not (rev_b and i == 2) else 'P-3A'
        d.text('TEXT', (p[0], p[1] - 900), 250, label, align=1)
    # 管线：总管 + 支管 + 阀门
    d.line('PIPE', (1200, 2600), (11200, 2600))
    d.line('PIPE', (1200, 6800), (11200, 6800))
    for i, (x, y) in enumerate(pumps):
        d.line('PIPE', (x - 600, y), (x - 600, 2600))
        if not (rev_b and i == 1):
            d.line('PIPE', (x + 600, y), (x + 600, 6800))
        d.insert('EQUIP', 'VALVE', (x - 600, 3600), 90)
    d.insert('EQUIP', 'VALVE', (1800, 2600))
    d.insert('EQUIP', 'VALVE', (10600, 6800))
    if rev_b: d.insert('EQUIP', 'VALVE', (6200, 6800))
    # 尺寸（手绘：尺寸线 + 起止符 + 文字）
    def dim_h(x0, x1, y, txt):
        d.line('DIM', (x0, y), (x1, y))
        for x in (x0, x1):
            d.line('DIM', (x, y - 300), (x, y + 300)); d.line('DIM', (x - 150, y - 150), (x + 150, y + 150))
        d.text('DIM', ((x0 + x1) / 2, y + 150), 300, txt, align=1)
    dim_h(0, 6000, -1200, '6000'); dim_h(6000, 12000, -1200, '6000'); dim_h(0, 12000, -2000, '12000')
    d.line('DIM', (W + 1200, 0), (W + 1200, H))
    for y in (0, H):
        d.line('DIM', (W + 900, y), (W + 1500, y)); d.line('DIM', (W + 1050, y - 150), (W + 1350, y + 150))
    d.text('DIM', (W + 1050, H / 2), 300, '8000', align=1)
    # 房间名称
    d.text('TEXT', (7400, 1500), 450, 'PUMP ROOM  泵房', align=1)
    d.text('TEXT', (7400, 900), 250, 'Floor finish +0.000', align=1)
    # 设备表（给「表格提取」演示用）
    tx, ty = 15500, 8800
    rows = [('No.', 'Equipment', 'Qty'), ('1', 'Pump 水泵', '4'), ('2', 'Valve 阀门', '7' if rev_b else '6'), ('3', 'Header pipe DN200', '2')]
    cw, rh = [1000, 3600, 1000], 700
    for r in range(len(rows) + 1):
        d.line('TABLE', (tx, ty - r * rh), (tx + sum(cw), ty - r * rh))
    x = tx
    for c in range(len(cw) + 1):
        d.line('TABLE', (x, ty), (x, ty - len(rows) * rh)); x += cw[c] if c < len(cw) else 0
    for r, row in enumerate(rows):
        x = tx
        for c, cell in enumerate(row):
            d.text('TABLE', (x + 200, ty - r * rh - 470), 250, cell); x += cw[c]
    d.text('TEXT', (tx, ty + 400), 350, 'EQUIPMENT LIST  设备表')
    # 图框与标题栏
    d.rect('FRAME', -4000, -4000, 22500, 12500)
    d.rect('FRAME', 15000, -4000, 22500, -1000)
    d.line('FRAME', (15000, -2500), (22500, -2500))
    d.text('FRAME', (15300, -1900), 350, 'Lightning Peek sample drawing')
    d.text('FRAME', (15300, -3400), 300, 'Pump room plan  1:100   ' + ('Rev B' if rev_b else 'Rev A'))
    return d


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    build(False).write(os.path.join(OUT, 'pump-room.dxf'))
    build(True).write(os.path.join(OUT, 'pump-room-rev-b.dxf'))
    print('written', OUT)
