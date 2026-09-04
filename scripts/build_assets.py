from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
XHS = ROOT / "promo" / "xhs"
ASSETS = ROOT / "docs" / "assets"
XHS.mkdir(parents=True, exist_ok=True)
ASSETS.mkdir(parents=True, exist_ok=True)

FONT_REGULAR = "C:/Windows/Fonts/msyh.ttc"
FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"

INK = "#202438"
MUTED = "#687086"
PURPLE = "#6D4AFF"
PURPLE_DARK = "#4D32C7"
ORANGE = "#FF6B35"
GREEN = "#20A66A"
RED = "#E84A5F"
GOLD = "#D68B00"
PAPER = "#F6F7FB"
WHITE = "#FFFFFF"
LINE = "#E2E5EE"


def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REGULAR, size)


def rounded(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def wrap(draw, text, fnt, max_width):
    lines, current = [], ""
    for char in text:
        candidate = current + char
        if current and draw.textbbox((0, 0), candidate, font=fnt)[2] > max_width:
            lines.append(current)
            current = char
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def text_block(draw, xy, text, fnt, fill=INK, max_width=None, spacing=8, anchor=None):
    x, y = xy
    lines = text.split("\n") if max_width is None else sum((wrap(draw, line, fnt, max_width) for line in text.split("\n")), [])
    line_height = fnt.size + spacing
    for i, line in enumerate(lines):
        draw.text((x, y + i * line_height), line, font=fnt, fill=fill, anchor=anchor)
    return y + len(lines) * line_height


def gradient(size, top, bottom):
    w, h = size
    a = tuple(int(top[i:i + 2], 16) for i in (1, 3, 5))
    b = tuple(int(bottom[i:i + 2], 16) for i in (1, 3, 5))
    img = Image.new("RGB", size)
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(h - 1, 1)
        c = tuple(int(a[j] * (1 - t) + b[j] * t) for j in range(3))
        d.line((0, y, w, y), fill=c)
    return img


def pill(draw, xy, text, fill, color=WHITE, padding=(18, 9), size=26):
    x, y = xy
    fnt = font(size, True)
    bbox = draw.textbbox((0, 0), text, font=fnt)
    w = bbox[2] - bbox[0] + padding[0] * 2
    h = bbox[3] - bbox[1] + padding[1] * 2
    rounded(draw, (x, y, x + w, y + h), h // 2, fill)
    draw.text((x + w / 2, y + h / 2 - 1), text, font=fnt, fill=color, anchor="mm")
    return w, h


def shadow_panel(base, box, radius=28, fill=WHITE, shadow=24, offset=12):
    x1, y1, x2, y2 = map(int, box)
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.rounded_rectangle((x1 + offset, y1 + offset, x2 + offset, y2 + offset), radius=radius, fill=(18, 20, 38, 45))
    layer = layer.filter(ImageFilter.GaussianBlur(shadow))
    base.alpha_composite(layer)
    d = ImageDraw.Draw(base)
    rounded(d, box, radius, fill)
    return d


def ellipsize(draw, text, fnt, max_width):
    if draw.textbbox((0, 0), text, font=fnt)[2] <= max_width:
        return text
    result = text
    while result and draw.textbbox((0, 0), result + "…", font=fnt)[2] > max_width:
        result = result[:-1]
    return result + "…"


def draw_course_card(draw, box, name, code, note, total, wishes, accent=PURPLE, selected=False, small=False):
    x1, y1, x2, y2 = box
    rounded(draw, box, 14, "#F4F0FF" if accent == PURPLE else "#FFF7EF", outline="#D8DCE8", width=2)
    draw.rounded_rectangle((x1, y1, x1 + 9, y2), radius=5, fill=accent)
    check_size = 16 if small else 23
    check = (x1 + 14, y1 + 16, x1 + 14 + check_size, y1 + 16 + check_size)
    draw.rectangle(check, fill=GREEN if selected else WHITE, outline=GREEN if selected else "#9DA4B3", width=2)
    title_size = 12 if small else 30
    meta_size = 10 if small else 22
    title_x = x1 + (38 if small else 58)
    title_font = font(title_size, True)
    if small:
        draw.text((title_x, y1 + 15), ellipsize(draw, name, title_font, max(20, x2 - title_x - 8)), font=title_font, fill=INK)
    else:
        drop_w, drop_h = 132, 37
        drop_x1 = x2 - drop_w - 20
        draw.text((title_x, y1 + 18), ellipsize(draw, name, title_font, max(20, drop_x1 - title_x - 6)), font=title_font, fill=INK)
        rounded(draw, (drop_x1, y1 + 12, x2 - 20, y1 + 12 + drop_h), 6, WHITE, outline="#ADB4C2")
        draw.text(((drop_x1 + x2 - 20) / 2, y1 + 12 + drop_h / 2), "第三志愿", font=font(18), fill=INK, anchor="mm")
    positions = (43, 64, 86, 108) if small else (62, 92, 126, 158)
    draw.text((x1 + 14, y1 + positions[0]), ellipsize(draw, code, font(meta_size), x2 - x1 - 28), font=font(meta_size), fill=MUTED)
    if note:
        draw.text((x1 + 14, y1 + positions[1]), ellipsize(draw, note, font(meta_size), x2 - x1 - 28), font=font(meta_size), fill="#815C10")
    draw.text((x1 + 14, y1 + positions[2]), total, font=font(meta_size, True), fill=GREEN if "—" not in total else MUTED)
    draw.text((x1 + 14, y1 + positions[3]), ellipsize(draw, wishes, font(meta_size), x2 - x1 - 28), font=font(meta_size), fill=INK)


def draw_browser_mock(base, box, dense=True):
    draw = ImageDraw.Draw(base)
    x1, y1, x2, y2 = box
    rounded(draw, box, 26, WHITE, outline="#CFD4E1", width=2)
    draw.rounded_rectangle((x1, y1, x2, y1 + 62), radius=26, fill="#303441")
    draw.rectangle((x1, y1 + 36, x2, y1 + 62), fill="#303441")
    for i, c in enumerate(("#FF6257", "#FFC043", "#31C853")):
        draw.ellipse((x1 + 25 + i * 34, y1 + 22, x1 + 41 + i * 34, y1 + 38), fill=c)
    draw.text((x1 + 142, y1 + 31), "研究生选课 · 课程表助手", font=font(20, True), fill="#E8EAF0", anchor="lm")

    sidebar = 120
    draw.rectangle((x1, y1 + 62, x1 + sidebar, y2), fill="#FFF6EF")
    draw.rectangle((x1, y1 + 62, x1 + sidebar, y1 + 124), fill=ORANGE)
    draw.text((x1 + sidebar / 2, y1 + 93), "研究生选课", font=font(18, True), fill=WHITE, anchor="mm")
    for i, label in enumerate(("时间安排", "选课帮助", "开课信息", "选课操作")):
        draw.text((x1 + 22, y1 + 160 + i * 50), label, font=font(17), fill=INK)

    mx1 = x1 + sidebar + 16
    my1 = y1 + 76
    draw.text((mx1, my1), "选课方案课程表", font=font(24, True), fill=INK)
    draw.text((mx1 + 244, my1 + 2), "65 个课序号  ·  人数查询完成", font=font(15), fill=MUTED)
    rounded(draw, (x2 - 177, my1 - 7, x2 - 20, my1 + 35), 10, WHITE, outline="#C9CEDA")
    draw.text((x2 - 99, my1 + 14), "刷新人数", font=font(16), fill=INK, anchor="mm")

    gx1, gy1, gx2, gy2 = mx1, my1 + 55, x2 - 20, y2 - 20
    time_w = 72
    cols = 5
    col_w = (gx2 - gx1 - time_w) / cols
    rows = 4 if dense else 3
    row_h = (gy2 - gy1 - 44) / rows
    rounded(draw, (gx1, gy1, gx2, gy2), 12, WHITE, outline=LINE, width=2)
    draw.rectangle((gx1, gy1, gx2, gy1 + 44), fill="#EBEEF5")
    draw.text((gx1 + time_w / 2, gy1 + 22), "时间", font=font(15, True), fill=INK, anchor="mm")
    for c, day in enumerate(("周一", "周二", "周三", "周四", "周五")):
        cx = gx1 + time_w + c * col_w
        draw.line((cx, gy1, cx, gy2), fill=LINE, width=2)
        draw.text((cx + col_w / 2, gy1 + 22), day, font=font(15, True), fill=INK, anchor="mm")
    for r in range(rows):
        yy = gy1 + 44 + r * row_h
        draw.line((gx1, yy, gx2, yy), fill=LINE, width=2)
        draw.text((gx1 + time_w / 2, yy + 24), f"第{r + 1}大节", font=font(13, True), fill=INK, anchor="mm")

    cards = [
        (1, 0, "工程硕士数学", "公共基础课 · 全周", "", "总108/159", "一15 · 二12 · 三81", PURPLE),
        (4, 0, "硕士生英语", "公共基础课 · 全周", "论文阅读写作", "总63/80", "一28 · 二17 · 三18", ORANGE),
        (1, 2, "自然辩证法概论", "公共必修课 · 前八周", "", "总52/120", "一20 · 二11 · 三21", PURPLE),
        (3, 3 if rows > 3 else 2, "新时代中国特色社会主义理论与实践", "公共必修课 · 后八周", "", "总89/120", "一34 · 二25 · 三30", GREEN),
    ]
    for col, row, name, code, note, total, wishes, color in cards:
        if row >= rows:
            continue
        cx1 = gx1 + time_w + col * col_w + 5
        cy1 = gy1 + 49 + row * row_h + 5
        cx2 = cx1 + col_w - 10
        cy2 = min(cy1 + row_h - 10, gy2 - 6)
        draw_course_card(draw, (cx1, cy1, cx2, cy2), name, code, note, total, wishes, color, small=True)


def cover():
    img = Image.new("RGBA", (1080, 1440), PAPER)
    d = ImageDraw.Draw(img)
    d.text((72, 66), "清华研究生选课课程表助手", font=font(26, True), fill=PURPLE)
    text_block(d, (72, 128), "把选课列表\n换成课程表", font(68, True), INK, spacing=12)
    d.text((74, 318), "课程时间 · 一二三志愿人数 · 登录状态", font=font(28), fill=MUTED)
    rounded(d, (55, 390, 1025, 1325), 30, WHITE, outline=LINE, width=2)
    draw_browser_mock(img, (85, 420, 995, 1295), dense=False)
    d = ImageDraw.Draw(img)
    d.text((72, 1360), "Tampermonkey · MIT License", font=font(22), fill=MUTED)
    img.convert("RGB").save(XHS / "01-cover.png", quality=95)


def features():
    img = Image.new("RGBA", (1080, 1440), PAPER)
    d = ImageDraw.Draw(img)
    d.text((68, 62), "功能", font=font(25, True), fill=PURPLE)
    text_block(d, (68, 120), "课程时间和志愿人数\n放在同一张课表里", font(58, True), INK, spacing=10)
    d.text((70, 270), "按星期查看课程，直接判断时间冲突", font=font(27), fill=MUTED)
    rounded(d, (50, 330, 1030, 1095), 28, WHITE, outline=LINE, width=2)
    draw_browser_mock(img, (74, 354, 1006, 1071), dense=False)
    d = ImageDraw.Draw(img)
    badges = [
        ("课程表排布", "星期 × 大节"),
        ("志愿人数", "总数 + 一二三志愿"),
        ("课程备注", "区分同名课程方向"),
        ("登录状态", "状态点实时提示"),
    ]
    y = 1135
    for i, (title, sub) in enumerate(badges):
        x = 60 + (i % 2) * 510
        yy = y + (i // 2) * 105
        rounded(d, (x, yy, x + 490, yy + 88), 14, WHITE, outline=LINE, width=2)
        d.ellipse((x + 20, yy + 34, x + 38, yy + 52), fill=PURPLE if i < 2 else ORANGE)
        d.text((x + 56, yy + 14), title, font=font(23, True), fill=INK)
        d.text((x + 56, yy + 49), sub, font=font(17), fill=MUTED)
    img.convert("RGB").save(XHS / "02-features.png", quality=95)


def counts():
    img = Image.new("RGBA", (1080, 1440), PAPER)
    d = ImageDraw.Draw(img)
    d.text((65, 62), "报名统计", font=font(25, True), fill=ORANGE)
    text_block(d, (65, 120), "总人数之外\n再看一二三志愿", font(58, True), INK, spacing=10)
    d.text((67, 270), "课程卡片直接显示报名结构", font=font(25), fill=MUTED)
    rounded(d, (110, 355, 970, 730), 28, WHITE, outline=LINE, width=2)
    d = ImageDraw.Draw(img)
    draw_course_card(d, (150, 400, 930, 680), "工程硕士数学", "公共基础课 · 全周", "", "总108/159", "一15 · 二12 · 三81", PURPLE)

    callouts = [
        ("总108/159", "报名总数 / 容量", GREEN),
        ("一15", "第一志愿", PURPLE),
        ("二12", "第二志愿", PURPLE),
        ("三81", "第三志愿", RED),
    ]
    y = 790
    for i, (big, small, color) in enumerate(callouts):
        x = 62 + (i % 2) * 505
        yy = y + (i // 2) * 170
        rounded(d, (x, yy, x + 465, yy + 140), 18, WHITE, outline=LINE, width=2)
        d.text((x + 24, yy + 24), big, font=font(32, True), fill=color)
        d.text((x + 24, yy + 80), small, font=font(21), fill=INK)
    img.convert("RGB").save(XHS / "03-counts.png", quality=95)


def steps():
    img = Image.new("RGBA", (1080, 1440), PAPER)
    d = ImageDraw.Draw(img)
    d.text((65, 62), "使用流程", font=font(25, True), fill=PURPLE)
    text_block(d, (65, 120), "4 步打开课程表", font(60, True), INK)
    items = [
        ("1", "安装 Tampermonkey", "在 Edge 或 Chrome 中安装扩展"),
        ("2", "保存脚本", "打开 user.js，粘贴并按 Ctrl+S"),
        ("3", "进入研究生选课", "信息门户 → 应用导航 → 研究生选课"),
        ("4", "打开课程表", "查看时间和人数，勾选课序并填志愿"),
    ]
    y = 275
    colors = (PURPLE, ORANGE, GREEN, RED)
    for i, (num, title, sub) in enumerate(items):
        yy = y + i * 250
        rounded(d, (68, yy, 1012, yy + 190), 20, WHITE, outline=LINE, width=2)
        d.ellipse((102, yy + 42, 212, yy + 152), fill=colors[i])
        d.text((157, yy + 97), num, font=font(48, True), fill=WHITE, anchor="mm")
        d.text((245, yy + 42), title, font=font(32, True), fill=INK)
        d.text((245, yy + 102), sub, font=font(23), fill=MUTED)
        if i < 3:
            d.line((157, yy + 190, 157, yy + 232), fill="#C8CDDA", width=5)
    img.convert("RGB").save(XHS / "04-steps.png", quality=95)


def keepalive():
    img = Image.new("RGBA", (1080, 1440), PAPER)
    d = ImageDraw.Draw(img)
    d.text((65, 62), "登录状态", font=font(25, True), fill=GREEN)
    text_block(d, (65, 120), "课程表按钮上\n直接显示登录状态", font(60, True), INK, spacing=10)
    d.text((67, 275), "脚本每 3 分钟执行一次同站检查", font=font(24), fill=MUTED)
    rounded(d, (105, 360, 975, 650), 28, WHITE, outline=LINE, width=2)
    d = ImageDraw.Draw(img)
    rounded(d, (240, 455, 840, 550), 16, WHITE, outline="#C9CEDA", width=3)
    d.text((320, 502), "选课课程表", font=font(34, True), fill=INK, anchor="lm")
    d.ellipse((770, 485, 798, 513), fill=GREEN)
    d.text((520, 590), "状态点显示在课程表入口旁", font=font(22), fill=MUTED, anchor="mm")

    states = [
        (GREEN, "绿色", "登录正常"),
        (GOLD, "橙色", "网络请求失败"),
        (RED, "红色", "登录已经失效"),
        ("#999999", "灰色", "正在检查"),
    ]
    y = 725
    for i, (color, name, desc) in enumerate(states):
        yy = y + i * 125
        rounded(d, (115, yy, 965, yy + 96), 16, WHITE, outline=LINE, width=2)
        d.ellipse((150, yy + 33, 180, yy + 63), fill=color)
        d.text((210, yy + 26), name, font=font(25, True), fill=INK)
        d.text((350, yy + 28), desc, font=font(23), fill=MUTED)
    img.convert("RGB").save(XHS / "05-keepalive.png", quality=95)


def opensource():
    img = Image.new("RGBA", (1080, 1440), "#171A28")
    d = ImageDraw.Draw(img)
    d.text((65, 65), "开源项目", font=font(25, True), fill="#A995FF")
    text_block(d, (65, 135), "脚本、说明和测试\n都在 GitHub", font(62, True), WHITE, spacing=10)
    d.text((67, 300), "github.com/Delthin/thu-graduate-course-helper", font=font(24), fill="#C8CDDC")
    cards = [
        ("只访问校内系统", "不接入第三方统计服务"),
        ("提交前确认", "不会自动提交或退课"),
        ("一个主脚本", "核心逻辑集中在 user.js"),
        ("MIT License", "可以自由使用、修改和分享"),
    ]
    y = 395
    for i, (title, sub) in enumerate(cards):
        yy = y + i * 175
        rounded(d, (65, yy, 1015, yy + 140), 18, "#24283B", outline="#393F58", width=2)
        d.ellipse((100, yy + 58, 124, yy + 82), fill=PURPLE if i % 2 == 0 else ORANGE)
        d.text((155, yy + 28), title, font=font(29, True), fill=WHITE)
        d.text((155, yy + 80), sub, font=font(22), fill="#C8CDDC")
    rounded(d, (65, 1135, 1015, 1325), 22, WHITE)
    d.text((100, 1170), "主要文件", font=font(24, True), fill=INK)
    text_block(d, (100, 1215), "thu-graduate-course-helper.user.js\nREADME.md  ·  test.cjs  ·  LICENSE", font(22), PURPLE_DARK, spacing=9)
    img.convert("RGB").save(XHS / "06-open-source.png", quality=95)


def operation_flow():
    img = Image.new("RGBA", (1600, 900), PAPER)
    d = ImageDraw.Draw(img)
    d.text((70, 60), "清华研究生选课课程表助手｜操作流程", font=font(46, True), fill=INK)
    d.text((72, 125), "安装脚本后，从信息门户进入选课系统即可使用", font=font(24), fill=MUTED)
    steps_data = [
        ("1", "安装油猴", "安装 Tampermonkey\n粘贴 user.js 并保存"),
        ("2", "进入选课", "信息门户 → 应用导航\n→ 研究生选课"),
        ("3", "查看课程表", "点击右上角\n“选课课程表 ●”"),
        ("4", "填报志愿", "看人数与备注\n勾选课序并确认提交"),
    ]
    colors = (PURPLE, ORANGE, GREEN, RED)
    for i, (num, title, sub) in enumerate(steps_data):
        x = 70 + i * 380
        rounded(d, (x, 230, x + 310, 690), 28, WHITE, outline=LINE, width=2)
        d.ellipse((x + 100, 275, x + 210, 385), fill=colors[i])
        d.text((x + 155, 330), num, font=font(48, True), fill=WHITE, anchor="mm")
        d.text((x + 155, 430), title, font=font(31, True), fill=INK, anchor="mm")
        text_block(d, (x + 155, 500), sub, font(22), MUTED, spacing=10, anchor="ma")
        if i < 3:
            d.line((x + 325, 460, x + 365, 460), fill="#B6BDCC", width=8)
            d.polygon(((x + 355, 445), (x + 380, 460), (x + 355, 475)), fill="#B6BDCC")
    img.convert("RGB").save(ASSETS / "operation-flow.png", quality=95)


def feature_overview():
    img = Image.new("RGBA", (1600, 900), "#F4F5FA")
    d = ImageDraw.Draw(img)
    d.text((65, 55), "从课程列表到可视化课程表", font=font(44, True), fill=INK)
    d.text((67, 115), "课程时间、志愿人数和备注集中显示", font=font(22), fill=MUTED)
    shadow_panel(img, (55, 180, 1120, 840), 28, WHITE, 18, 8)
    draw_browser_mock(img, (80, 205, 1095, 815), dense=False)
    d = ImageDraw.Draw(img)
    features_data = [
        ("课程冲突", "按星期和大节排布"),
        ("志愿结构", "总数 + 一二三志愿"),
        ("课程备注", "英语课方向清晰可见"),
        ("登录保活", "每 3 分钟轻量检查"),
        ("安全提交", "同步原表单，提交前确认"),
    ]
    y = 205
    for i, (title, sub) in enumerate(features_data):
        yy = y + i * 120
        rounded(d, (1160, yy, 1540, yy + 94), 20, WHITE, outline=LINE, width=2)
        d.ellipse((1184, yy + 30, 1218, yy + 64), fill=(PURPLE, ORANGE, GREEN, GOLD, RED)[i])
        d.text((1238, yy + 18), title, font=font(25, True), fill=INK)
        d.text((1238, yy + 55), sub, font=font(17), fill=MUTED)
    img.convert("RGB").save(ASSETS / "feature-overview.png", quality=95)


if __name__ == "__main__":
    cover()
    features()
    counts()
    steps()
    keepalive()
    opensource()
    operation_flow()
    feature_overview()
    print(f"Generated assets in {XHS} and {ASSETS}")
