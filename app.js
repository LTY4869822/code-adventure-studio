// Code-Adventure · 多页面 SPA：hash 路由 + 帘幕转场 + 星野按页面 morph。
//
// 引擎契约（逆向自 starflow.js，勿随意改动）：
//  1. 形状只在 shape.strength > 0 时成形；strength 经引擎指数阻尼（rate 6）趋近目标值。
//  2. createPathLayers 只按 viewBox 的「高」归一化 → 形状宽高比由路径包围盒决定，
//     sizeNdc 的宽必须用 EMBLEMS[key].aspect 推，不能用 viewBox 宽高比。
//  3. shape.sizeNdc 语义：2 × 目标像素 / 视口像素（宽、高各自独立计算）。
//  4. shapeAutoRotate 会让平面图形侧翻成一条线，必须为 false。
//  5. 换形状 = 先把 strength 降到 0 附近（星星退回 source 路径），再 setSource + 换 samples，
//     最后把 strength 推回 1。帘幕转场的遮蔽期正好完成这件事。
//  6. 【截图验收必读】引擎每帧只记 dt = min(真实帧间隔, 50ms)，所以帧率一低引擎时钟就慢。
//     软件渲染（swiftshader）下实测只有真实时间的 ~7%：introDuration=4s 要等 ~55s 真实时间，
//     未跑完时星星仍散在 source 路径上，截图看起来像「图腾没聚起来」——是假故障。
//     验收脚本必须等 uIntroProgress ≥ 0.95 且 shapeProgress ≥ 0.995 再拍；
//     想跳过等待可直接 astra.setConfig({ introDuration: 0.9 })（终态视觉完全一致）。
import {
  createAstraScene,
  createShapeSamples,
  detectWebGL,
  prefersReducedMotion,
  renderStaticFallback,
} from './starflow.js'
import { EMBLEMS } from './shapes.js'

/* ─────────────────────────── 路由表 ─────────────────────────── */
const ROUTES = {
  home:     { index: '01', name: '首页', en: 'HOME',     emblem: 'mobius',        fill: 0.86 },
  services: { index: '02', name: '服务', en: 'SERVICES', emblem: 'compass',       fill: 0.62 },
  // 作品页没有图腾 —— 原来的火箭已删，首屏交给开场的视频（见 index.html 的 .works-intro）。
  // emblem: null 会走「无图腾」分支：source 换成没有轮廓的 galaxy 场，星野仍然关在落点框里。
  // 注意「删掉图腾」不是把强度压到 0 就行的，理由见下面 SHAPELESS_SOURCE 的注释。
  works:    { index: '03', name: '作品', en: 'WORKS',    emblem: null,            fill: 0.62 },
  team:     { index: '04', name: '团队', en: 'TEAM',     emblem: 'constellation', fill: 0.62 },
  contact:  { index: '05', name: '联系', en: 'CONTACT',  emblem: 'saturn',        fill: 0.62 },
}
const routeFromHash = () => {
  const key = location.hash.replace(/^#\/?/, '').replace(/\/$/, '')
  return ROUTES[key] ? key : 'home'
}

const root = document.documentElement
const body = document.body
const $ = (s, c = document) => c.querySelector(s)
const $$ = (s, c = document) => Array.from(c.querySelectorAll(s))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const fine = matchMedia('(pointer: fine)').matches
const reduced = prefersReducedMotion()

/* ─────────────────────────── 文字拆分 ─────────────────────────── */
function splitLines(el) {
  const nodes = Array.from(el.childNodes)
  el.setAttribute('aria-label', el.textContent.trim())
  el.textContent = ''
  let lineIndex = 0
  const makeLine = () => {
    const line = document.createElement('span')
    line.className = 'line'
    line.setAttribute('aria-hidden', 'true')
    el.appendChild(line)
    return line
  }
  let line = makeLine()
  let charIndex = 0
  for (const node of nodes) {
    if (node.nodeName === 'BR') {
      line = makeLine()
      lineIndex++
      continue
    }
    for (const ch of node.textContent) {
      const span = document.createElement('span')
      span.className = 'ch'
      span.textContent = ch === ' ' ? ' ' : ch
      span.style.transitionDelay = `${(charIndex * 0.032 + lineIndex * 0.08).toFixed(3)}s`
      line.appendChild(span)
      charIndex++
    }
  }
}
$$('[data-split]').forEach(splitLines)

/* ─────────────────────────── 揭示动画 ─────────────────────────── */
function playReveals(view) {
  const els = $$('[data-reveal], [data-split]', view)
  els.forEach((el) => {
    el.classList.remove('on')
    el.style.transitionDelay = ''
  })
  // 强制 reflow 后再加 .on，否则 transition 不会重播
  void view.offsetWidth
  els.forEach((el, i) => {
    if (el.hasAttribute('data-reveal')) el.style.transitionDelay = `${Math.min(0.12 + i * 0.07, 0.9)}s`
    requestAnimationFrame(() => el.classList.add('on'))
  })
}

/* 长页段落与团队成员：真正进入视口后再渐变显现。 */
const scrollRevealEls = $$('[data-scroll-reveal]')
if (reduced || !('IntersectionObserver' in window)) {
  scrollRevealEls.forEach((el) => el.classList.add('on'))
} else {
  const scrollRevealObserver = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.add('on')
      observer.unobserve(entry.target)
    }
  }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' })
  scrollRevealEls.forEach((el) => scrollRevealObserver.observe(el))
}

const scrollProgress = $('.scroll-progress i')
const updateScrollProgress = () => {
  const max = Math.max(1, document.documentElement.scrollHeight - innerHeight)
  scrollProgress.style.transform = `scaleX(${Math.min(1, Math.max(0, scrollY / max))})`
}
addEventListener('scroll', updateScrollProgress, { passive: true })
addEventListener('resize', updateScrollProgress, { passive: true })
updateScrollProgress()

$('.home-scroll-cue')?.addEventListener('click', (event) => {
  event.preventDefault()
  $('#home-story')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
})

/* ─────────────────────────── 星野引擎 ─────────────────────────── */
const canvas = document.getElementById('astra')
let astra = null
const samples = {}

/* 降级路径（无 WebGL / 减少动态）：引擎不跑，画布由 renderStaticFallback 画一次死图。
   逆向它的实现（bundle 里的 $c）：它读画布**自己的 getBoundingClientRect()**、
   按那个盒子缩放星场（min(w*fillX/size[0], h*fillY/size[1])），还把整块底填成纯黑
   —— 也就是说「画布盒子多大、放哪儿，图腾就多大、在哪儿」。
   而主路径（WebGL）的画布是铺满视口的透明层，图腾位置每帧由 .emblem-stage 的 rect
   换算成 NDC 决定。两条路径的「落点框」因此不是一回事：
   原先这里写死 mobius、画布又铺满整屏 → **每个路由看到的都是铺满屏幕的 ∞**，
   内容页左侧 56vw 的正文正好压在左瓣上（见 shots/v7-08b-static-services.png，
   副文案和两条 flow 描述全被糊掉）。
   现在让画布盒子 = 当前路由的 .emblem-stage：直接量它的 rect 贴上去。
     · stage 是 fixed（桌面内容页的常驻图腾）→ 画布也 fixed，跟随视口；
     · stage 是 relative（≤900px 时图腾进文档流）→ 画布用 absolute + 文档坐标，
       图腾便跟着内容一起滚走，不会钉在视口里把滚上来的正文压住。
   落点框用和主路径同一套公式（fillX 0.94 对应 JS 里的 rect.width*0.94、fillY = route.fill），
   但**两条路径算出来的实际大小并不严格相等**：主路径的 sizeNdc 宽要用 EMBLEMS[key].aspect 推
   （见文件头第 2 条），兜底这边 $c 用的是路径包围盒 p.size，两者只在 aspect 恰好等于
   viewBox 宽高比时才一致。这里不去补这个差 —— 兜底本来就是另一套渲染器，
   实测下来位置对得上、大小在同一个量级就够了（见 shots/v7-08b-static-services.png）。 */
const paintStatic = (over = {}) => {
  const route = ROUTES[drive.route]
  const view = $(`[data-view="${drive.route}"]`)
  const stageEl = view && $('.emblem-stage', view)
  if (stageEl && !view.hidden) {
    const r = stageEl.getBoundingClientRect()
    const fixed = getComputedStyle(stageEl).position === 'fixed'
    canvas.style.position = fixed ? 'fixed' : 'absolute'
    canvas.style.left = `${Math.round(fixed ? r.left : r.left + window.scrollX)}px`
    canvas.style.top = `${Math.round(fixed ? r.top : r.top + window.scrollY)}px`
    canvas.style.width = `${Math.round(r.width)}px`
    canvas.style.height = `${Math.round(r.height)}px`
  }
  // 采样参数和主路径共用 emblemTune()：星数/散度/亮度保留都取同一套。
  // 例外有两个，都是因为 $c 的半径公式 (0.35 + scale*density*3.8) 和 WebGL 的精灵缩放不是一回事：
  //   · size 0.7（主路径 2.05）—— 亮星还要再乘 6 倍画一层 alpha 0.7 的径向光斑，
  //     照抄 2.05 画出来是一片饱和的大光斑：整块画布 13.6% 的像素饱和（255）。
  //     团队页 .page-sub 首行宽 805px、右端伸进画布盒子 179px，直接被糊掉（2.1:1）。
  //   · dimSizeScale 1.6（主路径 0.8）—— 它只缩放**暗尘**（brightness<1.35 的那些，
  //     公式里 lerp(s,1,smoothstep(v,1.35,1.65)) 对暗星取 s）。size 收到 0.7 之后
  //     罗盘外圈那些稀疏暗星会小到看不见、形状读不全，靠它单独把暗尘放大补回来，
  //     亮星半径一点不动（所以饱和像素不会反弹）。
  // 按 appearance 对齐而不是按数值对齐，扫出来的结果（_debug/_staticopt.mjs）：
  //   团队页 .page-sub 外圈 p95 9.04:1（超阈 0.46%）、主理人简介 9.08:1（超阈 3.46%），
  //   而整块画布的饱和像素从 12.75% 掉到 2.13%，星星变细 —— 反而更接近主路径的星点质感。
  const tune = emblemTune(route.emblem)
  const emblem = route.emblem ? EMBLEMS[route.emblem] : null
  renderStaticFallback(
    canvas,
    // 无图腾路由：降级路径也画一片没有轮廓的星野（galaxy 源），画在落点框里
    emblem ? { type: 'paths', paths: emblem.paths, viewBox: emblem.viewBox } : SHAPELESS_SOURCE,
    {
      fillX: 0.94,
      fillY: route.fill,
      starCount: tune.starCount,
      size: 0.7,
      dimSizeScale: 1.6,
      scatter: tune.scatter,
      backgroundRatio: tune.backgroundRatio,
      rotationDepth: 1.4,
      palette: 'astra',
      pathShape: true,
      brightRetention: 0.5,
      ...over,
    },
  )
}
// 探针用：_debug/_staticopt.mjs 靠它在降级路径上扫采样参数
window.__paintStatic = paintStatic

const isStatic = !detectWebGL() || reduced

if (isStatic) {
  root.dataset.static = 'true'
  // 首屏绘制交给 applyRoute —— 它先落 data-route、取消 view.hidden，量出的 rect 才是对的
  let resizeTimer
  addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    // 盒子尺寸变了：位图必须重画（否则被拉伸），画布盒子也要重新贴
    resizeTimer = setTimeout(paintStatic, 200)
  })
} else {
  for (const [key, e] of Object.entries(EMBLEMS)) samples[key] = createShapeSamples(e.paths, e.viewBox)

  astra = createAstraScene(canvas, {
    // 氛围底：原项目是 #23435f / opacity .55 / vignette 1。实测过隔离对照——
    // 环境色 +5.3/255、渐晕 −1.8/255，原项目组合净 +2.2/255 ≈ 0.9%，低于大面积
    // 均匀场约 2% 的可辨阈，肉眼看不出来。所以这里保留站点自己的设计 token
    // （--astra-ambient-color 写在 CSS :root 里，属设计系统），不为了不可见的差异去改它。
    ambientColor: getComputedStyle(root).getPropertyValue('--astra-ambient-color').trim() || '#16283f',
    ambientOpacity: 0.5,
    vignette: 0.82,
    bloomIntensity: 0.68,
    bloomThreshold: 0.08, // 原项目：辉光来自「极低阈值」，不是大半径
    introDuration: 4,
    // 7. 【粒子质感 · 关键】原项目 README「最容易做错的四件事」里，我们原先错了三件，
    //    结果星星全被钉在路径上，糊成一圈圈平行的「钢丝」，没有星云的体积感：
    //      · shapeScatter 默认 1（合法域 0..3），我们用了 0.032/0.09 → 垂直抖动几乎为 0
    //      · shapeBrightRetention 默认 0.5，我们用了 0.92 → 没有亮星/暗尘的层次
    //      · dimSizeScale path-shape 预设 0.8，我们用了 1
    //    配合 size 2.05（亮星画到 ~15px 再交给 bloom → 大而柔的光斑）才有原项目的质感。
    //    shapeScatter 取 0.5~0.6 而不是 1：原站形状长在 80vh 的侧栏里，我们的图腾要和
    //    文案共处一屏，1.0 的星带会糊到标题上（实测过，见 shots/_ab/ab-mobius-orig.png）。
    shapeScatter: 0.6,
    shapeBrightRetention: 0.5,
    dimSizeScale: 0.8,
    shapeAutoRotate: false,
    // 8. 【流动速度 0.8 → 0.002】用户反馈「开头的倒 8 转速太快，容易眩晕」。
    //
    //    先纠正一个我之前搞错、这次量清楚了的事实：**图腾的星不吃 coreSpin**。
    //    着色器有两条旋转分支（bundle @607878）：
    //      if (isCore > 0.5)            rotate(pos, uCoreRotation)      ← coreSpin 只管这个
    //      else if (isBackground < 0.5) rotate(pos, uLayerSpin[layer])  ← 图腾的星走这条
    //    而采样时图腾的星是 `isCore: !1`（bundle @594147）；uLayerSpin 又是跟随指针的
    //    阻尼偏移，不是持续旋转。所以 coreSpin 从来没让 ∞ 转过（实测 false/true 画面差
    //    都是 0.0432，完全一样）。真正的持续运动是**沿轮廓的流动**：
    //      localPhase = fract(localSeed + uShapeFlowOffset * |starPath.y| * sign / span)
    //      starPath.y = kl.speed * p / span          （span = 该子路径占总弧长的比例）
    //    ⇒ 相位速率 = flowSpeed × kl.speed / span²      圈/引擎秒
    //    ⇒ 屏幕速度 = flowSpeed × kl.speed × L_total / span  像素/秒
    //    这张图有 24 条子路径（14 轨道 + 10 碎弧），单条 span 只有 0.047；引擎的 kl 表还会把
    //    每条路径复制成 5 层（每层 span 再除以 Σf≈4.54）→ 实际 span ≈ 0.0104。
    //    代入 0.025/0.0104² ≈ 229 圈/引擎秒 per flowSpeed，再乘 L_total ≈ 46200px：
    //      flowSpeed 0.8 → 最快那层约 **106000 px/s**（60fps 下每帧 1770px）
    //    这不是「转得快」，这是**噪声**：_debug/_flowcoh.mjs 量到只要手摇
    //    uShapeFlowOffset 0.00187，整幅画就与随机相位无法区分 —— 0.8 时完全翻新一次只需
    //    0.0023 引擎秒，**不到一帧**。用户看到的「眩晕」就是这团频闪，不是旋转。
    //
    //    取值依据（_debug/_flowlook.mjs：钉住相位、按 flowSpeed/60 步进，摆出连续 60fps 的
    //    8 帧，量相邻两帧的归一化互相关 NCC —— 越接近 1 越像「同一批星在平移」）：
    //      0.8 → 0.34 每帧几乎重画（噪声）   0.01  → 0.65
    //      0.05→ 0.36                        0.005 → 0.73 偏快
    //                                        0.003 → 0.86
    //                                        0.002 → 0.92  ← 取这里
    //                                        0.001 → 0.97
    //                                        0.0005→ 0.97 偏呆
    //    0.002 落在「0.0005~0.003 都能读出平滑流动」这段的中间偏慢一侧：屏幕速度约 210px/s
    //    （≈3.5px/帧，远小于星点 ~15px 的直径），图案横穿整个 ∞（1325px）约需 6 秒 ——
    //    是「缓缓流动」而不是「旋转」。慢下来还有第二个好处：速度低到眼睛能跟住特征之后，
    //    带面的**宽度收窄**（腰/端 = 0.637）才读得出来，莫比乌斯环的扭转感才立得住。
    //
    //    为什么可以放心连背景一起降速（flowSpeed 同时推 uFlowOffset = 背景星的相位）：
    //    _debug/_skyflow.mjs 实测把 uFlowOffset 单独推到 3.2（原速的 4 倍），空天区平均差
    //    0.0011~0.0029，与完全冻结时的 0.0023 无趋势差别 —— 背景星对画面的贡献本来就淹没在
    //    噪声地板里，降速不损失任何看得见的东西。场子的「活」来自闪烁（uTwinkleSpeed，不受影响）。
    //
    //    ⚠️ 这个 0.002 是 ∞ 的值，也是**首帧之前的默认值**。实际生效的 flowSpeed 由
    //    frame 循环按「图腾当前屏幕尺寸」算出来（每个图腾一个 flowK 常数，见 EMBLEM_TUNE
    //    上面的说明）—— 因为星点直径是固定像素，图腾越小越要加快，否则窄屏上根本看不出在动。
    flowSpeed: 0.002,
    // 9. coreSpin 只管中间那颗英雄星的面内自转（见上），而它是正圆光斑，转了也看不出来。
    //    留着 false：避免任何元素做无意义的 2D 面内旋转 —— 那种旋转只会把立体感抹平。
    coreSpin: false,
  })
  window.__astra = astra
  adaptIntroDuration(astra)
}

/* 引擎每帧只累加 min(真实帧间隔, 50ms)，所以帧率一低引擎时钟就落后：
   软件渲染下实测只有真实时间的 ~7%，introDuration=4s 要拖到 ~55s 真实时间，
   期间星星还散在 source 路径上，看着像「图腾没聚起来」。
   这里跳过前 5 帧预热（着色器编译），量 15 帧平均间隔，把 introDuration 折算成
   引擎秒，让真实世界里无论快慢都在 ~4s 内成形。快机器实测 ratio≈1，参数不变。 */
function adaptIntroDuration(scene) {
  const TARGET = 4 // 期望的真实秒数
  const SKIP = 5 // 预热帧（着色器编译等）
  const SAMPLE = 15
  let n = 0
  let realMs = 0
  let clockMs = 0
  let last = performance.now()
  const tick = (now) => {
    const dt = now - last
    last = now
    if (++n <= SKIP) return requestAnimationFrame(tick)
    realMs += dt
    clockMs += Math.min(dt, 50) // 与引擎主循环同款折算
    if (n - SKIP < SAMPLE) return requestAnimationFrame(tick)
    const ratio = clockMs / realMs // 引擎时钟 / 真实时间，快机器≈1
    scene.setConfig({ introDuration: Math.min(TARGET, Math.max(0.5, TARGET * ratio)) })
    window.__introRatio = +ratio.toFixed(3)
  }
  requestAnimationFrame(tick)
}

// 每个图腾一套调参。基准值直接取原项目 README 的 path-shape 预设
// （size 2.05 / scatter 0.05 / backgroundRatio 0.14），只按落点框大小调星数。
// 星数是「绝对数量」不是密度：同样的星数铺在更宽的星带里，环与环之间会互相填缝，
// 所以展宽星带不需要同比例加星（实测 10000 颗在 1354×600 的框里已经够满）。
//
// ─────────────────────── flowK：每图腾的流速常数 ───────────────────────
// 【为什么不能给每个图腾写一个固定 flowSpeed】判据是无量纲的「每帧位移 ÷ 星点直径」，
// 而**星点直径是 ~15px 的固定像素值，不随图腾缩放**。实测（_debug/_flowaudit.mjs 跑两个视口）：
//   要让位移保持同一无量纲值所需的 flowSpeed 之比 —— ∞ 3.94、罗盘 2.24、火箭 2.24、土星 1.59；
//   而它们的屏幕总弧长之比 ——            4.01 /    2.22 /    2.22 /    1.70。
// 两者吻合 ⇒ flowSpeed ∝ 1/L_total ⇒ **图腾越小越要快**。窄屏上图腾只有桌面的 1/4 弧长，
// 若沿用桌面的固定值，每帧只移动 0.9px（亚像素）—— 那不是「慢」，那是**看不见在动**。
// 所以每个图腾只存一个与视口无关的常数 flowK，运行时 flowSpeed = flowK / scale，
// scale = 图腾屏幕宽度 / viewBox 宽度（与 frame 循环算落点用的是同一个 w，单一来源）。
//
// flowK 怎么来的：_debug/_flowaudit.mjs 把五个图腾的每条子路径在单位 flowSpeed 下的
// 每帧位移算出来，然后扫 flowSpeed，取「落在可读带内的弧长占比」最大的一段平台的中点。
// 可读带 0.12~1.0 星点宽/帧 不是拍的，是拿 ∞ 的 NCC 实测反推的：0.003 时 NCC 0.856（仍算流动）
// → 最快那层 1.06；0.001 时 NCC 0.966（偏呆）→ 最慢那层 0.121。
// **自洽性检验**：这套规则算出的 ∞ 平台是 0.0010~0.0028，而 0.002 正是上一轮用 NCC 手工定下来、
// 并已通过全套验收的值 —— 规则独立复现了实测结论，所以可以放心用它推另外四个。
//
//   图腾            flowK       桌面 scale   → 桌面 flowSpeed   可读弧长  越界的部分是什么
//   ∞ / mobius      0.001157    0.579        → 0.0020           100%     ——
//   罗盘 / compass  0.114386    0.511        → 0.2239            96%     轴心小圆点 + 北标三角（共 4.3% 弧长）
//   火箭 / rocket   0.143966    0.511        → 0.2818            79%     3 条火焰 + 6 个火星（共 21%）
//   星座 / constellation 0.033644 0.378       → 0.0891           100%     ——
//   土星 / saturn   0.050143    0.316        → 0.1585            98%     卫星小点（2.2%）
// 越界的那几处都是**本来就该闪的小装饰**（火花、卫星、罗盘轴心），不是主体：
// 罗盘 96% / 土星 98% / 火箭 79% 的弧长都在带内，而且越界的方向全是「偏快」不是「冻结」。
// 火箭最差（span 跨 90.6×，机身 39% 弧长 + 两片尾翼 30% 都在带内），这是它路径结构决定的，
// 除非重做几何，否则没有单一标量能更好。
// ⚠️ 火箭已经从路由里摘掉了（作品页改放开场视频，见 ROUTES.works），这一行现在是**未接线的**：
//   留着是因为 shapes.js 里火箭的路径还在，__forceEmblem('rocket') 之类的探针仍能把它调出来，
//   而它需要自己的 flowK 才动得对（删掉这行它会退回 default 的 0.001157，比正确值慢 124 倍，
//   看上去就是「冻住了」）。哪天真要重做作品页的图腾，再跑一遍 _debug/_flowaudit.mjs 复核。
const EMBLEM_TUNE = {
  mobius: { starCount: 12000, size: 2.05, scatter: 0.06, backgroundRatio: 0.14, shapeScatter: 0.6, flowK: 0.001157 },
  default: { starCount: 9000, size: 2.05, scatter: 0.06, backgroundRatio: 0.14, shapeScatter: 0.5, flowK: 0.001157 },
  compass: { flowK: 0.114386 },
  rocket: { flowK: 0.143966 },
  constellation: { flowK: 0.033644 },
  saturn: { flowK: 0.050143 },
  // 无图腾路由（作品页）：没有几何可以推 flowK，只有一片均匀星野。
  // starCount 要按「关进落点框之后」的密度算 —— galaxy 场被 center/fill 收进右栏后
  // 面积只剩约 1/4，同样的星数会亮 4 倍（实测 9000 颗时亮像素 41710，火箭才 ~7000）。
  // 3200 颗时亮像素回到同一量级（见 shots/_debug/ 的对照）。
  shapeless: { starCount: 3200, size: 2.05, scatter: 0.06, backgroundRatio: 0.14, shapeScatter: 0.5 },
  // 窄屏（断点与 CSS 的 900px 一致）：落点框只剩 ~390×340，∞ 实际只有 ~330×150。
  // 星带相对形状等比，所以密度不随屏幕缩水，只需按面积减星。
  // flowK 不在这里覆盖 —— 它本来就是与视口无关的常数，缩放交给 flowSpeed = flowK / scale。
  narrow: { starCount: 5000, size: 2.05, scatter: 0.065, backgroundRatio: 0.14, shapeScatter: 0.62 },
}
const narrowMQ = matchMedia('(max-width: 900px)')

// 当前视口下该图腾生效的调参 —— 主路径（setEmblemSource）和降级路径（paintStatic）共用，
// 免得两条路各调各的、越走越远。key 为 null（无图腾路由）时落到 shapeless 那一档。
const emblemTune = (key) => ({
  ...EMBLEM_TUNE.default,
  ...(EMBLEM_TUNE[key ?? 'shapeless'] ?? {}),
  ...(narrowMQ.matches ? EMBLEM_TUNE.narrow : null),
})

/* ── 「无图腾」路由（作品页）─────────────────────────────────────────
   把成形强度压到 0 **并不能**让图腾消失 —— 这是实测出来的，不是推理：
   引擎 CPU 端的星位 b 是从 **source 路径的采样点**上取的（qc(e.samples, r, b)），
   与 shapeProgress / shapePosition 无关。所以 strength 归零之后，
   火箭的轮廓照样清清楚楚（对照图 shots/_debug/noemb-A-formed.png 与 noemb-B-strength0.png）。
   要让图腾真的消失，只能**换 source**：这里换成引擎自带的 galaxy 场 —— 它没有轮廓，
   就是一片均匀星野（shots/_debug/noemb-C-galaxy.png）。

   但 galaxy 场默认铺满整个视口（实测亮像素范围 x[47..1381]），会压到正文，
   于是再用 config 的 center / fillX / fillY 把它关回落点框里（见 syncFieldBox），
   实测收进右栏后 x[827..1366]，仍在框内 —— verify.mjs 那条「星云不得越出落点框」的不变量继续成立。 */
const SHAPELESS_SOURCE = { type: 'galaxy' }
// 无图腾时星野的流速。没有几何可推 flowK，取一个和 ∞ 同量级的固定氛围值就够了 ——
// 这片场只是背景，不需要「每帧位移落在可读带内」那套判据。
const SHAPELESS_FLOW = 0.002

// 落点框的 config 形态 —— 引擎的 ce() 就是用它算场的位置和缩放的。
// 有图腾的页面用引擎自己的默认值（我们的代码从不碰这三项）；无图腾路由由 syncFieldBox 按落点框收窄。
const FIELD_FULL = { center: [0, 0], fillX: 0.8, fillY: 0.89 }

function setEmblemSource(key, o = {}) {
  if (!astra) return
  const e = key ? EMBLEMS[key] : null
  const tune = { ...emblemTune(key), ...o }
  astra.setSource(
    e ? { type: 'paths', paths: e.paths, viewBox: e.viewBox } : SHAPELESS_SOURCE,
    {
      starCount: tune.starCount,
      size: tune.size,
      scatter: tune.scatter,
      backgroundRatio: tune.backgroundRatio,
      rotationDepth: 1.4,
      palette: 'astra',
      pathShape: !!e, // galaxy 源没有 raster，这一项本来就被引擎忽略；写 !!e 只是别撒谎
      brightRetention: 0.5, // 一半亮星压暗到 42% —— 亮星/暗尘的层次就来自这里
      ...(tune.extra ?? {}),
    },
  )
  astra.setConfig({
    shapeScatter: tune.shapeScatter,
    shapeBrightRetention: 0.5,
    dimSizeScale: 0.8,
    ...FIELD_FULL, // 先复位；无图腾路由随后由 syncFieldBox 按落点框收窄
  })
  // ⚠️ 上面那次 setConfig 把 center/fillX/fillY 复位成整屏了，必须让 syncFieldBox 的缓存失效。
  // 不失效的话：切页时 applyRoute 立刻生效（route.emblem 已是 null），syncFieldBox 会在
  // **上一个图腾还在**的时候先收窄一次并写进缓存；随后 morphTo 里的 setEmblemSource 复位成整屏，
  // 而 syncFieldBox 看到缓存命中就跳过 —— 星野于是留在整屏，压到正文。
  // 实测症状：直接打开 #/works 是收窄的（x[833..1356]），从别的页面**切过去**却是整屏（x[40..]），
  // verify.mjs 报「星云越界 738px」。
  boxApplied = { key: null, x: 0, y: 0, w: 0, h: 0 }
}

// 调试用：探针脚本用来在线改参
window.__EMBLEMS = EMBLEMS
// 只换「当前路由指向哪个图腾」，不重跑 setEmblemSource —— 让探针能完全接管参数
window.__setRouteEmblem = (key) => { ROUTES[drive.route].emblem = key }
window.__strength = (v) => tweenStrength(v, 200)
window.__emblemDebug = (o = {}) => {
  const r = ROUTES[drive.route]
  if (o.fill !== undefined) r.fill = o.fill
  setEmblemSource(r.emblem, o)
  tweenStrength(1, 200)
}
window.__forceEmblem = (key) => {
  ROUTES[drive.route].emblem = key
  setEmblemSource(key)
  tweenStrength(1, 200)
}

/* ── 成形强度的时间补间（引擎再做一层指数阻尼平滑） ── */
const drive = { route: routeFromHash(), strength: 0 }
let tween = null
function tweenStrength(to, duration, onDone) {
  tween = { from: drive.strength, to, start: performance.now(), duration, onDone }
}

// 跨过窄屏断点时星数要换一套（否则旋转手机后图腾还是错的密度）
narrowMQ.addEventListener('change', () => {
  if (astra) setEmblemSource(ROUTES[drive.route].emblem)
})

/* flowSpeed 的唯一属主 —— 见 EMBLEM_TUNE 上面的推导（flowSpeed = flowK / scale）。
   只在流速变了 >2% 时才写，免得每帧都去动 config（setConfig 内部会重算投影和落点）。 */
let flowApplied = { key: null, value: 0 }
function syncFlowSpeed(key, scale) {
  if (!astra) return
  // 无图腾路由没有几何可推 flowK，用固定的氛围流速（见 SHAPELESS_FLOW）
  const flowK = key ? emblemTune(key).flowK : null
  const target = flowK ? flowK / scale : SHAPELESS_FLOW
  if (!(target > 0)) return
  if (flowApplied.key === key && Math.abs(target - flowApplied.value) <= flowApplied.value * 0.02) return
  flowApplied = { key, value: target }
  astra.setConfig({ flowSpeed: target })
  // 探针脚本读的实时值：验收时要能确认「桌面 ∞ 0.002 / 窄屏 ~0.008」这类量
  window.__flow = { key, scale: +scale.toFixed(4), flowK: flowK ?? null, flowSpeed: +target.toFixed(6) }
}

/* 无图腾路由的星野要关回落点框 —— galaxy 场默认铺满整屏（实测亮像素 x[47..1381]），
   会压到正文。center / fillX / fillY 是 config 级的，改它们会触发引擎的 ce()
   重算投影与像素比，所以只在框真的变了 >2% 时才写，别每帧都写。 */
let boxApplied = { key: null, x: 0, y: 0, w: 0, h: 0 }
function syncFieldBox(key, rect, vw, vh) {
  if (!astra || key) return // 有图腾的页面用引擎默认值（setEmblemSource 里已复位）
  if (!(rect.width > 0) || !(rect.height > 0)) return
  const x = ((rect.left + rect.width / 2) / vw) * 2 - 1
  const y = 1 - ((rect.top + rect.height / 2) / vh) * 2
  const w = rect.width / vw
  const h = rect.height / vh
  const near = (a, b) => Math.abs(a - b) <= Math.max(Math.abs(b), 1e-3) * 0.02
  if (boxApplied.key === key && near(x, boxApplied.x) && near(y, boxApplied.y)
    && near(w, boxApplied.w) && near(h, boxApplied.h)) return
  boxApplied = { key, x, y, w, h }
  astra.setConfig({ center: [x, y], fillX: w, fillY: h })
}

if (astra) {
  setEmblemSource(ROUTES[drive.route].emblem)
  const frame = (now) => {
    if (tween) {
      const t = Math.min(1, (now - tween.start) / tween.duration)
      drive.strength = tween.from + (tween.to - tween.from) * easeInOut(t)
      if (t === 1) {
        const cb = tween.onDone
        tween = null
        cb && cb()
      }
    }
    const route = ROUTES[drive.route]
    const view = $(`[data-view="${drive.route}"]`)
    const stageEl = view && $('.emblem-stage', view)
    if (stageEl && !view.hidden) {
      const rect = stageEl.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const emblem = route.emblem ? EMBLEMS[route.emblem] : null
      // 按宽高比在框内取最大可容纳尺寸（宽、高各守一条边）；无图腾时框内就是整片星野
      const maxW = rect.width * 0.94
      const maxH = rect.height * route.fill
      let w = maxW
      let h = emblem ? w / emblem.aspect : maxH
      if (emblem && h > maxH) { h = maxH; w = h * emblem.aspect }
      // 图腾的屏幕缩放（px / viewBox 单位）—— flowSpeed 就是按它反比缩放的
      syncFlowSpeed(route.emblem, emblem ? w / (emblem.viewBox[2] - emblem.viewBox[0]) : 1)
      // 调试：_debug/_fieldbox.mjs 读这个 —— 直接显示这一帧塞进 setScroll 的强度
      window.__pushed = {
        routeKey: route.emblem,
        emblemVar: emblem ? 'emblem' : 'null',
        pushedStrength: emblem ? drive.strength : 0,
        driveStrength: drive.strength,
        fill: route.fill,
      }
      // 无图腾路由：把星野关回落点框（galaxy 场默认铺满整屏）。见 syncFieldBox
      syncFieldBox(route.emblem, rect, vw, vh)
      window.__lastNdc = {
        c: [+(((rect.left + rect.width / 2) / vw) * 2 - 1).toFixed(3), +(1 - ((rect.top + rect.height / 2) / vh) * 2).toFixed(3)],
        s: [+((w / vw) * 2).toFixed(3), +((h / vh) * 2).toFixed(3)],
        rect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)],
      }
      astra.setScroll({
        progress: Math.max(window.scrollY / 800, 0),
        shape: {
          // 无图腾路由的强度**恒为 0**，而且必须是 0 —— 不只是「没必要成形」：
          // 引擎的形状纹理 H.lastSamples 是**粘的**（setScroll 收到 samples=null 就跳过更新），
          // 上一个图腾的采样点还留在纹理里；只要 shapeProgress > 0，星星就会被拉回
          // **上一个图腾**的形状。实测过：光把 strength 压到 0，火箭照样看得见
          // （shots/_debug/noemb-B-strength0.png）。所以「换 source」和「强度恒 0」缺一不可。
          // 在这里兜这一道，任何一条补间路径（boot / goto instant / morphTo）漏了都不会出事。
          strength: emblem ? drive.strength : 0,
          id: route.emblem,
          samples: emblem ? samples[route.emblem] : null,
          centerNdc: [
            ((rect.left + rect.width / 2) / vw) * 2 - 1,
            1 - ((rect.top + rect.height / 2) / vh) * 2,
          ],
          sizeNdc: [(w / vw) * 2, (h / vh) * 2],
        },
      })
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

/* ─────────────────────────── 作品页 · 开场视频 ─────────────────────────── */
/* src 挂在 data-src 上，不写在 src 里 —— 只有真的进过作品页才去下这 3.4MB，
   首页/服务/团队/联系四个页面对它是零开销（不是「延迟加载」，是根本不发请求）。
   离开作品页就暂停：它是 loop 的，不暂停会一直在后台解码烧电。
   reduced（系统的「减少动态」）时不自动播，只留 poster 那张静帧 —— 尊重用户偏好。 */
let introLoaded = false
function syncIntroVideo(route) {
  const vid = $('.works-intro-video')
  if (!vid) return
  if (route === 'works') {
    if (!introLoaded) { introLoaded = true; vid.src = vid.dataset.src }
    if (!reduced) { const p = vid.play(); p && p.catch(() => {}) }
  } else if (!vid.paused) {
    vid.pause()
  }
}

/* 声音开关：浏览器不允许自动播放带声音的视频，所以默认静音，交给用户自己开。
   开了声音之后不再自动关回去 —— 用户的选择就是这个会话里的状态。 */
function wireIntroSound() {
  const btn = $('.works-intro-sound')
  const vid = $('.works-intro-video')
  if (!btn || !vid) return
  const label = $('.works-intro-sound-text', btn)
  btn.addEventListener('click', () => {
    const wasMuted = vid.muted
    vid.muted = !wasMuted
    // aria-pressed = 「声音现在开着吗」：原来静音 → 点完就是开着
    btn.setAttribute('aria-pressed', String(wasMuted))
    if (label) label.textContent = wasMuted ? '关闭声音' : '开启声音'
    // 开声音时才真正起播（万一之前自动播放被拦了，这次是用户手势，一定放得出来）
    if (!wasMuted) { const p = vid.play(); p && p.catch(() => {}) }
  })
}

/* 滚动提示：不能用 <a href="#…"> —— 这个站是 hash 路由，
   任何不是路由名的 hash 都会被 routeFromHash 判成 'home' 把页面顶回首页。 */
function wireIntroCue() {
  const cue = $('.works-intro-cue')
  const list = $('#works-list')
  const heading = $('.view-works .page-head')
  if (!cue || !list) return
  cue.addEventListener('click', () => {
    ;(heading || list).scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  })
}

/* 作品页的正文被 100vh 的开场视频推到首屏之外：若照常规在切进路由时就播揭示动画，
   用户滚到那儿时动画早演完了 —— 等于白做。这一页改成「正文进视口才播」。 */
let worksObs = null
function deferWorksReveals() {
  const view = $('[data-view="works"]')
  const list = $('#works-list')
  if (!view || !list) return
  worksObs?.disconnect()
  worksObs = new IntersectionObserver((ents) => {
    if (!ents.some((e) => e.isIntersecting)) return
    worksObs.disconnect()
    worksObs = null
    playReveals(view)
  }, { rootMargin: '0px 0px -15% 0px' })
  worksObs.observe(list)
}
const playViewReveals = (route) =>
  (route === 'works' ? deferWorksReveals() : playReveals($(`[data-view="${route}"]`)))

/* ─────────────────────────── 视图切换 ─────────────────────────── */
const wipe = $('.wipe')
const wipePanels = $$('.wipe-panel', wipe)
const wipeWord = $('.wipe-word', wipe)
let navigating = false

function applyRoute(route) {
  drive.route = route
  // 只是给探针/验收脚本一个「当前路由」的锚点（画布落点不靠 CSS 选择器，见 paintStatic）
  body.dataset.route = route
  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== route })
  window.scrollTo(0, 0)
  requestAnimationFrame(updateScrollProgress)
  $$('.site-nav a, .menu-overlay a').forEach((a) => a.classList.toggle('active', a.dataset.route === route))
  const meta = ROUTES[route]
  $('.side-index').textContent = meta.index
  $('.side-name').textContent = meta.name
  document.title = `${meta.name} · Code-Adventure`
  syncIntroVideo(route)
  playViewReveals(route)
  // 降级路径的画布要跟着路由换：必须在 view.hidden / scrollTo 之后量 rect（见 paintStatic）
  if (isStatic) paintStatic()
}

async function morphTo(route) {
  // 先把形状压回星尘，遮蔽期换 source + samples，再重新成形
  tweenStrength(0.12, 320, () => {
    setEmblemSource(ROUTES[route].emblem)
    tweenStrength(1, 1400)
  })
}

/* 转场要 1.5s，期间用户完全可能再点一次别的路由。直接丢掉会出事：
   hash 已经变成新路由了，屏幕却停在旧的 —— 之后再点同一个链接 hash 不变 →
   不触发 hashchange → 彻底卡死。所以记下最后一跳，转场一结束就补上（last click wins）。 */
let pendingRoute = null
const endNav = () => {
  navigating = false
  const next = pendingRoute
  pendingRoute = null
  if (next && next !== drive.route) goto(next)
}

async function goto(route, instant = false) {
  if (route === drive.route) return
  if (navigating) { pendingRoute = route; return }
  navigating = true
  body.classList.remove('menu-open')

  if (instant || reduced || !astra) {
    applyRoute(route)
    if (astra) tweenStrength(1, 900)
    endNav()
    return
  }

  wipeWord.textContent = ROUTES[route].en
  wipe.classList.add('on')
  const inAnims = wipePanels.map((p, i) =>
    p.animate(
      [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }],
      { duration: 520, delay: i * 70, easing: 'cubic-bezier(.76,0,.24,1)', fill: 'forwards' },
    ).finished,
  )
  const wordIn = wipeWord.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 260, fill: 'forwards' }).finished
  await Promise.all([...inAnims, wordIn])

  applyRoute(route)
  morphTo(route)

  await wait(240)
  const outAnims = wipePanels.map((p, i) => {
    p.style.transformOrigin = 'top'
    return p.animate(
      [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0)' }],
      { duration: 560, delay: i * 70, easing: 'cubic-bezier(.76,0,.24,1)', fill: 'forwards' },
    ).finished
  })
  const wordOut = wipeWord.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' }).finished
  await Promise.all([...outAnims, wordOut])
  wipe.classList.remove('on')
  wipePanels.forEach((p) => { p.style.transformOrigin = 'bottom' })
  endNav()
}

window.addEventListener('hashchange', () => goto(routeFromHash()))

/* ─────────────────────────── 预加载 ─────────────────────────── */
async function boot() {
  applyRoute(drive.route) // 先摆好首屏（不播动画的畸形态无所谓，帘子挡着）
  const loader = $('.loader')
  const count = $('.loader-count')
  const bar = $('.loader-bar i')

  if (reduced) {
    loader.remove()
    if (astra) tweenStrength(1, 10)
    playViewReveals(drive.route)
    return
  }

  let p = 0
  await new Promise((resolve) => {
    const tick = () => {
      p = Math.min(100, p + 4 + Math.random() * 9)
      count.textContent = String(Math.floor(p)).padStart(3, '0')
      bar.style.transform = `scaleX(${p / 100})`
      p >= 100 ? resolve() : setTimeout(tick, 80)
    }
    tick()
  })
  await wait(280)
  loader.classList.add('done')
  await wait(950)
  loader.remove()

  if (astra) tweenStrength(1, 2400)
  playViewReveals(drive.route)
}

/* ─────────────────────────── 自定义光标 ─────────────────────────── */
if (fine && !reduced) {
  const cursor = $('.cursor')
  const dot = $('.cursor-dot')
  const ring = $('.cursor-ring')
  let mx = innerWidth / 2, my = innerHeight / 2, rx = mx, ry = my
  addEventListener('mousemove', (e) => {
    mx = e.clientX; my = e.clientY
    dot.style.transform = `translate(${mx}px, ${my}px)`
  })
  ;(function follow() {
    rx += (mx - rx) * 0.16
    ry += (my - ry) * 0.16
    ring.style.transform = `translate(${rx}px, ${ry}px)`
    requestAnimationFrame(follow)
  })()
  addEventListener('mousedown', () => cursor.classList.add('down'))
  addEventListener('mouseup', () => cursor.classList.remove('down'))
  document.addEventListener('mouseover', (e) => {
    cursor.classList.toggle('hover', !!e.target.closest('a, button, [data-hover]'))
  })
} else {
  $('.cursor').remove()
}

/* ─────────────────────────── 磁吸按钮 ─────────────────────────── */
if (fine && !reduced) {
  for (const el of $$('.magnetic')) {
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect()
      const x = e.clientX - r.left - r.width / 2
      const y = e.clientY - r.top - r.height / 2
      el.style.transition = 'transform .12s linear'
      el.style.transform = `translate(${x * 0.28}px, ${y * 0.28}px)`
    })
    el.addEventListener('mouseleave', () => {
      el.style.transition = 'transform .5s cubic-bezier(.22,.61,.21,1)'
      el.style.transform = ''
    })
  }
}

/* ─────────────────────────── 团队全息卡 ─────────────────────────── */
if (fine && !reduced) {
  for (const card of $$('[data-holo-card]')) {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect()
      const px = (e.clientX - r.left) / r.width
      const py = (e.clientY - r.top) / r.height
      card.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`)
      card.style.setProperty('--my', `${(py * 100).toFixed(1)}%`)
      card.style.setProperty('--rx', `${((0.5 - py) * 8).toFixed(2)}deg`)
      card.style.setProperty('--ry', `${((px - 0.5) * 10).toFixed(2)}deg`)
    })
    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--mx', '50%')
      card.style.setProperty('--my', '50%')
      card.style.setProperty('--rx', '0deg')
      card.style.setProperty('--ry', '0deg')
    })
  }
}

/* ─────────────────────────── 页头与菜单 ─────────────────────────── */
const header = $('.site-header')
addEventListener('scroll', () => header.classList.toggle('scrolled', scrollY > 8), { passive: true })
$('.menu-btn').addEventListener('click', () => body.classList.toggle('menu-open'))
$$('.menu-overlay a').forEach((a) => a.addEventListener('click', () => body.classList.remove('menu-open')))

/* ─────────────────────────── 作品页开场视频的两个控件 ─────────────────────────── */
wireIntroSound()
wireIntroCue()

/* 联系页：微信行点击复制微信号（退回 mailto 兜底，见 index.html）。 */
function wireContactExtras() {
  const wx = $('[data-copy]')
  if (!wx) return
  wx.addEventListener('click', async (e) => {
    e.preventDefault()
    const id = wx.dataset.copy
    try {
      await navigator.clipboard.writeText(id)
    } catch {
      // 非安全上下文 / 被拦截：退回打开邮件，至少能联系上
      location.href = 'mailto:hello@code-adventure.dev?subject=微信联系'
      return
    }
    const hint = wx.querySelector('.copy-hint')
    if (hint) {
      const t = hint.textContent
      hint.textContent = '已复制'
      setTimeout(() => { hint.textContent = t }, 1600)
    }
  })
}

wireContactExtras()

/* 联系表单：无后端，提交时组一封预填邮件（mailto）。
   想接真实接口时，把 submit 里的 location.href 换成 fetch(你的 endpoint) 即可。 */
function wireContactForm() {
  const form = $('.contact-form')
  if (!form) return
  const note = $('.form-note', form)
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const name = form.elements['name'].value.trim()
    const email = form.elements['email'].value.trim()
    const msg = form.elements['message'].value.trim()
    if (!name || !email || !msg) {
      note.textContent = '请把三项都填一下。'
      note.classList.add('err')
      return
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      note.textContent = '邮箱格式好像不太对。'
      note.classList.add('err')
      return
    }
    note.classList.remove('err')
    note.textContent = '正在为你打开邮件客户端…'
    const subject = encodeURIComponent(`项目咨询 · ${name}`)
    const body = encodeURIComponent(`称呼：${name}\n邮箱：${email}\n\n${msg}`)
    location.href = `mailto:hello@code-adventure.dev?subject=${subject}&body=${body}`
  })
}

wireContactForm()

boot()
