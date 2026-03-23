# WebPiano

Web 端特效钢琴可视化播放器。纯 HTML / CSS / JS 实现，无任何第三方依赖，无需构建步骤。

![preview](https://img.shields.io/badge/platform-browser-blueviolet) ![license](https://img.shields.io/badge/license-MIT-pink)

---

## 看什么readme，直接预览https://webpiano.makuraly.xyz/
## 功能

- **MIDI 文件可视化播放** — 瀑布流音符下落，精确对齐钢琴键
- **多轨道颜色** — 每条轨道独立配色，支持实时自定义
- **三级音源系统** — 优先本地采样 → CDN 采样 → 振荡器合成，自动降级
- **延音踏板支持** — 读取 MIDI CC64 信号，准确模拟踏板行为
- **PC 键盘演奏** — 两个八度（C3–C5），无需 MIDI 控制器
- **智能粒子特效** — 按键触发上浮粒子 + 丝状拖尾 + 烟雾，动态性能优化
- **瀑布火焰 FX** — 音符落到键盘线时触发涟漪爆发和火焰粒子
- **自定义背景图** — 支持 URL 或本地文件，可调透明度，IndexedDB 持久化
- **播放控制** — 播放 / 暂停 / 停止 / 进度条跳转 / 速度调节 / 音量调节
- **小节线网格** — 可一键开关
- **拖放导入** — 直接将 .mid 文件拖入浏览器窗口

---

## 快速开始

```bash
# 克隆仓库
git clone <repo-url>
cd webpiano

# 启动本地 HTTP 服务器（必须，file:// 无法加载音源）
python -m http.server 8000
# 或
npx serve .
```

然后在浏览器打开 `http://localhost:8000`。

> **为什么必须用 HTTP 服务器？**
> 浏览器的安全策略禁止 `file://` 协议下的 `fetch()`，而音源文件和默认 MIDI 均通过 `fetch()` 加载。

---

## 目录结构

```
webpiano/
├── index.html                  # 入口页面，所有 UI 结构
├── css/
│   └── style.css               # 暗色粉霓虹主题样式
├── js/
│   ├── constants.js            # 全局常量（颜色、钢琴范围、布局比例）
│   ├── audio.js                # Web Audio API 引擎
│   ├── midi-parser.js          # 二进制 .mid 文件解析器
│   ├── midi-player.js          # MIDI 播放调度器（双循环架构）
│   ├── particles.js            # 粒子系统（上浮粒子 + 烟雾）
│   ├── piano.js                # 键盘布局、Canvas 渲染、PC 键盘输入
│   ├── waterfall.js            # 瀑布流渲染 + 火焰 / 涟漪特效
│   └── main.js                 # 应用启动、渲染循环、UI 事件绑定
└── samples_ogg/                # （可选）本地 OGG 钢琴采样
    ├── Close Grand 1.ogg       # MIDI 21 (A0)
    ├── Close Grand 2.ogg       # MIDI 22
    ├── ...
    └── Close Grand 88.ogg      # MIDI 108 (C8)
```

---

## 技术实现

### 渲染管线

每帧按以下顺序绘制到**单张 Canvas**：

```
drawBackground()          — 背景图 / 键盘区暗色填充
WaterfallRenderer.draw()  — 瀑布流音符 + 火焰/涟漪粒子
particles.draw()          — 按键爆发粒子（键盘平面上方）
KeyboardRenderer.draw()   — 88 键钢琴
```

所有层都在同一个 `<canvas>` 上绘制，无 z-index 层叠问题。

### 时钟与调度

- **主时钟**：`AudioContext.currentTime`（高精度，永不被 GC 暂停）
- **双循环**：
  - `setInterval(25 ms)` — 音频预调度（lookahead），把即将到来的音符提前推入 Web Audio 调度队列
  - `requestAnimationFrame` — 视觉渲染，从 `player.songTime` 读取当前播放位置

### 瀑布数学

```
pps      = waterfallHeight / FALL_SECONDS     // 每秒对应的像素高度
yBottom  = waterfallH - (startSec - t) * pps  // 音符前沿 y 坐标
yTop     = waterfallH - (endSec   - t) * pps  // 音符尾端 y 坐标
```

当 `startSec == t` 时 `yBottom == waterfallH`，音符精确落到键盘线。

### 键盘布局

- 88 键，MIDI 21 (A0) … 108 (C8)，52 个白键，36 个黑键
- 黑键宽 = 白键宽 × 0.60，高 = 键盘高 × 0.63
- 黑键 x 坐标 = `whiteIndex * whiteKeyWidth - blackKeyWidth / 2`（居中于白键缝）

### 动态粒子管理

`particles.js` 实现智能性能优化，防止音符密集时卡顿：

**自适应消散算法**
- 实时监控粒子数量和渲染帧率
- 粒子数超过 80% 阈值或帧率低于 50fps → 消散速度自动提升 2-7 倍
- 低负载时逐渐恢复正常消散速度

**预防性限流**
- 粒子数达 70% 容量时，新粒子生成量减半
- 粒子数达 90% 容量时，新粒子生成量降至 10%
- 超过 120% 时触发紧急清理，移除生命值最低的粒子

**性能参数**
- 默认限制：普通粒子 500 个，烟雾 200 个
- 可通过 `particles.setLimits(maxParticles, maxSmoke)` 自定义阈值
- 调用 `particles.getStats()` 查看实时统计：
  ```js
  {
    particles: 247,           // 当前粒子数
    smoke: 68,                // 当前烟雾数
    total: 315,               // 总数
    decayMultiplier: "2.3",   // 当前消散倍率
    frameTime: "16.2",        // 平均帧时间 (ms)
    particleLoad: "49%",      // 粒子负载率
    smokeLoad: "34%"          // 烟雾负载率
  }
  ```

**工作原理**
1. 每帧测量渲染时间，平滑计算平均帧率
2. 计算粒子/烟雾负载率（当前数量 / 最大容量）
3. 根据负载率和帧率动态调整 `decayMultiplier`
4. 所有粒子的 `life` 每帧额外减少 `decay × (decayMultiplier - 1)`
5. 高负载时粒子消失更快，释放渲染资源

### MIDI 解析

`midi-parser.js` 直接解析二进制 SMF 格式，无外部依赖。输出标准化的 `noteEvents[]` 数组：

```js
{
  midi:       60,      // MIDI 音符编号
  startSec:   1.234,   // 绝对时间（秒）
  endSec:     1.856,
  velocity:   80,
  trackIndex: 0,
}
```

---

## 音源系统

引擎按以下优先级自动选择音源，**无需手动配置**：

```
Priority 1  本地 OGG 采样  (samples_ogg/)     ← 音质最佳
Priority 2  Salamander CDN MP3               ← 联网时自动加载
Priority 3  振荡器合成                         ← 离线 fallback
```

### 自定义本地音源（Priority 1）

在项目根目录创建 `samples_ogg/` 文件夹，放入 **88 个 OGG 文件**，命名格式严格为：

```
Close Grand 1.ogg    ← MIDI 21（A0，最低音）
Close Grand 2.ogg    ← MIDI 22
Close Grand 3.ogg    ← MIDI 23
...
Close Grand 88.ogg   ← MIDI 108（C8，最高音）
```

文件 N 对应 MIDI 编号 `N + 20`。

加载时若成功读取 **≥ 80 个**文件则视为本地音源有效，跳过 CDN。



#### 使用其他音色库

任何格式为 OGG、每键一文件、覆盖 88 键的采样库均可使用。
若文件来自其他音色库但命名规则不同，修改 `js/audio.js` 顶部的辅助函数：

```js
const _LOCAL_BASE  = './samples_ogg/';        // 文件夹路径
function _localUrl(n)  { return `${_LOCAL_BASE}Close%20Grand%20${n}.ogg`; }
function _localMidi(n) { return n + 20; }     // 文件序号 → MIDI 编号
function _localN(midi) { return midi - 20; }  // MIDI 编号 → 文件序号
```

例如，改为 `Steinway_` 前缀、序号从 0 开始：

```js
function _localUrl(n)  { return `${_LOCAL_BASE}Steinway_${n - 1}.ogg`; }
function _localMidi(n) { return n + 20; }
function _localN(midi) { return midi - 20; }
```

#### 使用 MP3 / WAV 格式

将 `_localUrl` 里的 `.ogg` 后缀改为 `.mp3` 或 `.wav` 即可，Web Audio API 均支持。

```js
function _localUrl(n) { return `${_LOCAL_BASE}piano_${n}.mp3`; }
```

---

## 默认 MIDI 文件

启动时若未手动导入，自动加载根目录的 `【鸣潮】3.1 OST 我与你.mid`。
替换为其他文件只需修改 `js/main.js` 顶部的常量：

```js
const DEFAULT_MIDI = '你的文件名.mid';
```

设为空字符串可禁用自动加载：

```js
const DEFAULT_MIDI = '';
```

---

## Playlist 播放列表

项目支持自动加载 `playlist/` 文件夹中的 MIDI 文件。

### 添加新曲目

1. 将 `.mid` 或 `.midi` 文件放入 `playlist/` 文件夹
2. 运行生成脚本更新索引：
   ```bash
   node generate-playlist.js
   ```
3. 刷新页面，新曲目会出现在播放列表中

### 静态部署说明

静态托管平台（Cloudflare Pages、GitHub Pages 等）不支持动态 API，因此需要 `playlist/playlist.json` 文件：

- **本地开发**：使用 Node.js 服务器时，会自动通过 `/api/playlist` 读取
- **静态部署**：优先读取 `playlist/playlist.json`（需预先生成）

**部署前务必运行**：
```bash
node generate-playlist.js
```

这将扫描 `playlist/` 文件夹并生成 `playlist.json`，确保部署后播放列表正常加载。

---

## 全局配置（constants.js）

| 常量 | 默认值 | 说明 |
|------|--------|------|
| `FALL_SECONDS` | `2.2` | 瀑布流可视时间窗口（秒），越大音符越早出现 |
| `KEYBOARD_FRAC` | `0.22` | 键盘区占 Canvas 高度的比例 |
| `BLACK_KEY_WIDTH_RATIO` | `0.60` | 黑键宽度 / 白键宽度 |
| `BLACK_KEY_HEIGHT_RATIO` | `0.63` | 黑键高度 / 白键高度 |
| `TRACK_COLORS` | 8 色数组 | 每轨道的 `{fill, glow}` 颜色，可在此修改默认配色 |

---

## 键盘快捷键

### PC 键盘演奏（两个八度）

```
低八度  C3–B3:  Z  S  X  D  C  V  G  B  H  N  J  M
高八度  C4–C5:  Q  2  W  3  E  R  5  T  6  Y  7  U  I
```

（黑键映射到数字行，白键映射到字母行）

### 全局快捷键

| 按键 | 功能 |
|------|------|
| `Space` | 播放 / 暂停 |
| `Escape` | 关闭弹窗 |

---

## 部署

### Cloudflare Pages（推荐）

**方式一：Git 自动部署**

1. 推送到 GitHub / GitLab
2. Cloudflare Dashboard → Workers & Pages → Create → Connect to Git
3. Build command：**留空**；Build output directory：`/`
4. 保存并部署，每次 `git push` 自动更新

**方式二：直接上传**

将整个项目文件夹打包为 zip → Cloudflare Pages → Upload assets → 上传并部署。

> 注意：`samples_ogg/` 目录如果包含 88 个文件，需确认总大小 < 25 MB（Cloudflare Pages 单次上传限制）。

### 其他静态托管

Vercel、Netlify、GitHub Pages 均支持，配置与 Cloudflare Pages 相同（无构建命令，根目录输出）。

### 本地开发

```bash
python -m http.server 8000   # Python 3
# 或
npx serve .                  # Node.js
# 或
php -S localhost:8000         # PHP
```

---

## 浏览器兼容性

| 特性 | 要求 |
|------|------|
| Canvas 2D | 所有现代浏览器 |
| Web Audio API | Chrome 66+ / Firefox 76+ / Safari 14+ |
| `roundRect()` | Chrome 99+ / Firefox 112+ / Safari 15.4+ |
| `backdrop-filter` | Chrome 76+ / Safari 9+（Firefox 需开启 flag）|

---

## 架构说明

所有 JS 文件通过 `<script>` 标签全局变量顺序加载，无 ES Module，无打包器。这样设计是为了兼容 `file://` 协议下的直接打开（尽管音源加载仍需 HTTP）。

加载顺序：`constants` → `audio` → `midi-parser` → `midi-player` → `particles` → `piano` → `waterfall` → `main`

`AudioContext` 遵循浏览器自动播放策略，**延迟到首次用户交互**（导入 MIDI 或按键盘键）时初始化。
