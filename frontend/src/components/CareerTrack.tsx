import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Pause, Play } from 'lucide-react'
import './CareerTrack.css'

const motionQuery = '(prefers-reduced-motion: reduce)'
function subscribeMotion(onChange: () => void) {
  const media = window.matchMedia(motionQuery)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}
const readReducedMotion = () => window.matchMedia(motionQuery).matches
const legPoses = [
  'M-5 0 -7 34 -5 67 -11 70',
  'M-5 0 -11 38 -15 48 -20 47',
  'M-5 0 -13 37 -10 18 -15 17',
  'M-5 0 -8 22 -4 44 -10 46',
]
const armPoses = ['M-8 0 -20 33 -27 29', 'M-8 0 -22 28 -12 12']

export function CareerTrack() {
  const [paused, setPaused] = useState(false)
  const [ready, setReady] = useState(false)
  const initialized = useRef(false)

  useEffect(() => {
    // Mount the complete static SVG first. Insert SMIL only after its first
    // rendering opportunity, so it cannot start against a partial SVG tree.
    const frame = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  const sceneRef = useRef<SVGSVGElement>(null)
  const reducedMotion = useSyncExternalStore(subscribeMotion, readReducedMotion, () => true)

  useLayoutEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    if (ready && !initialized.current) {
      scene.setCurrentTime(0)
      initialized.current = true
    }
    // CSS pause rules do not control SMIL's independent timeline.
    if (!ready || paused || reducedMotion) scene.pauseAnimations()
    else scene.unpauseAnimations()
    if (reducedMotion) scene.setCurrentTime(0)
  }, [ready, paused, reducedMotion])

  return (
    <section className={`career-track w-full border-y border-border ${paused ? 'is-paused' : ''} ${ready ? 'is-ready' : ''}`} aria-label="职业跑道">
      <div className="relative z-10 mx-auto max-w-5xl flex items-start justify-between gap-4 px-6 pt-6">
        <div>
          <p className="mb-2 font-mono text-[10px] tracking-[0.24em] text-muted-foreground">YOUR NEXT CHAPTER</p>
          <h2 className="text-lg font-medium tracking-tight">找到方向，每一步都向前。</h2>
          <p className="mt-2 text-xs text-muted-foreground">从读懂岗位开始，跑向你的下一站。</p>
        </div>

      </div>
      <svg ref={sceneRef} className="track-scene" viewBox="0 0 1200 420" fill="none" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <path d="M0 100H1200" stroke="currentColor" opacity="0.1" />
        <circle cx="600" cy="100" r="72" stroke="currentColor" opacity="0.06" />
        <circle cx="600" cy="100" r="52" stroke="currentColor" strokeDasharray="2 9" opacity="0.12" />
        <path d="M570 100 120 420H1080L630 100Z" fill="currentColor" opacity="0.025" />
        <g stroke="currentColor">
          {[-600, -120, 360, 840, 1320, 1800].map((x, i) => (
            <path key={x} d={`M${570 + i * 12} 100L${x} 420`} opacity={i === 2 || i === 3 ? 0.28 : 0.12} />
          ))}
          {[0, 1, 2, 3, 4, 5].map(i => (
            <path key={i} className="track-grid" style={{ animationDelay: `${i * -0.5}s` }} d="M-1800 420H3000" opacity="0.12" />
          ))}
        </g>
        <ellipse className="track-shadow" cx="600" cy="338" rx="29" ry="7" fill="currentColor" opacity="0.12" />
        <g className="track-runner" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
          {/* 参考迎面跑姿：窄步幅，支撑腿接近中轴，回收腿的小腿折在身后。 */}
          <circle cx="600" cy="177" r="15" fill="var(--card)" />
          <g fill="currentColor" stroke="none">
            <circle cx="595" cy="175" r="1.8" />
            <circle cx="605" cy="175" r="1.8" />
          </g>
          <path d="M600 198 600 230 600 260 M592 207H608 M595 260H605" />
          {(['left', 'right'] as const).map(side => {
            const legOffset = side === 'left' ? 0 : 2
            const armOffset = side === 'left' ? 1 : 0
            const legs = [...legPoses.slice(legOffset), ...legPoses.slice(0, legOffset)]
            const arms = [armPoses[armOffset], armPoses[1 - armOffset], armPoses[armOffset]]
            return (
              <g key={side}>
                <g transform={`translate(600 207) scale(${side === 'left' ? 1 : -1} 1)`}>
                  <path className={`track-arm track-arm-${side}`} d={arms[0]}>
                    {ready && <animate attributeName="d" values={arms.join(';')} dur="0.64s" repeatCount="indefinite"
                      calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" />}
                  </path>
                </g>
                <g transform={`translate(600 260) scale(${side === 'left' ? 1 : -1} 1)`}>
                  <path className={`track-leg track-leg-${side}`} d={legs[0]}>
                    {ready && <animate attributeName="d" values={[...legs, legs[0]].join(';')} dur="0.64s"
                      keyTimes="0;0.25;0.5;0.75;1" calcMode="linear" repeatCount="indefinite" />}
                  </path>
                </g>
              </g>
            )
          })}
        </g>
        <g fill="currentColor" opacity="0.25" fontFamily="monospace" fontSize="11" letterSpacing="3">
          <text x="395" y="375">01</text><text x="785" y="375">02</text>
        </g>
      </svg>
      <div className="relative mx-auto max-w-5xl flex items-center justify-between gap-3 border-t border-border px-6 py-4 text-[11px] text-muted-foreground">
        <span>岗位洞察 <span className="mx-2 opacity-40">/</span> 简历进阶 <span className="mx-2 opacity-40">/</span> 面试准备</span>
        <button type="button" onClick={() => setPaused(!paused)} aria-label={paused ? '播放跑道动画' : '暂停跑道动画'} aria-pressed={paused} className="track-toggle flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
          {paused ? <Play size={13} /> : <Pause size={13} />}
        </button>
      </div>
    </section>
  )
}
