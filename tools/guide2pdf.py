# 把 docs/user-guide.zh-CN.md 转成 HTML（只处理本文档用到的 Markdown 语法），再由 Chromium 打印成 PDF
import re, sys, html, os
src, out = sys.argv[1], sys.argv[2]
base = os.path.dirname(os.path.abspath(src))
lines = open(src, encoding='utf-8').read().split('\n')
def inline(t):
    t = html.escape(t, quote=False)
    t = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', lambda m: f'<img alt="{m[1]}" src="file://{os.path.join(base, m[2])}">', t)
    t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', t)
    t = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', t)
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    return t
o = []; i = 0; inlist = False
while i < len(lines):
    l = lines[i]
    if l.startswith('|') and i + 1 < len(lines) and re.match(r'^\|[\s\-|:]+\|$', lines[i + 1]):
        cells = lambda r: [c.strip() for c in r.strip().strip('|').split('|')]
        o.append('<table><tr>' + ''.join(f'<th>{inline(c)}</th>' for c in cells(l)) + '</tr>')
        i += 2
        while i < len(lines) and lines[i].startswith('|'):
            o.append('<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in cells(lines[i])) + '</tr>'); i += 1
        o.append('</table>'); continue
    if re.match(r'^(- |\d+\. )', l):
        if not inlist: o.append('<ul>' if l.startswith('- ') else '<ol>'); inlist = 'ul' if l.startswith('- ') else 'ol'
        o.append('<li>' + inline(re.sub(r'^(- |\d+\. )', '', l)) + '</li>'); i += 1; continue
    if inlist: o.append(f'</{inlist}>'); inlist = False
    m = re.match(r'^(#{1,3}) (.*)', l)
    if m: o.append(f'<h{len(m[1])}>{inline(m[2])}</h{len(m[1])}>')
    elif l.startswith('> '): o.append('<blockquote>' + inline(l[2:]) + '</blockquote>')
    elif l.strip() == '---': o.append('<hr>')
    elif l.strip().startswith('!['): o.append('<p class="fig">' + inline(l.strip()) + '</p>')
    elif l.strip(): o.append('<p>' + inline(l) + '</p>')
    i += 1
if inlist: o.append(f'</{inlist}>')
css = '''body{font-family:"Noto Sans CJK SC","Microsoft YaHei",sans-serif;font-size:10.5pt;line-height:1.65;color:#1d2733;margin:0}
h1{font-size:22pt;color:#1d2a3a;border-bottom:3px solid #f5a300;padding-bottom:6px;margin-top:0}
h2{font-size:15pt;color:#1d2a3a;margin-top:22px;border-left:5px solid #f5a300;padding-left:8px;page-break-after:avoid}
h3{font-size:12pt;margin-top:14px;page-break-after:avoid}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:9.5pt;page-break-inside:avoid}
th,td{border:1px solid #c9d0d9;padding:4px 7px;text-align:left;vertical-align:top}th{background:#eef2f6}
code{background:#eef2f6;border-radius:3px;padding:0 3px;font-family:Consolas,monospace;font-size:9pt}
blockquote{margin:8px 0;padding:6px 10px;background:#fff7e0;border-left:4px solid #f5a300}
img{max-width:100%;border:1px solid #c9d0d9;border-radius:4px}.fig{text-align:center;page-break-inside:avoid}
hr{border:0;border-top:1px solid #dde2e8;margin:14px 0}a{color:#1f6fd1;text-decoration:none}'''
open(out, 'w', encoding='utf-8').write(f'<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>闪电看图 使用说明</title><style>{css}</style></head><body>{"".join(o)}</body></html>')
