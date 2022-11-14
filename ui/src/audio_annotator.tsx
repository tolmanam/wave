import * as Fluent from '@fluentui/react'
import { B, F, Id, Rec, S, U } from 'h2o-wave'
import React from 'react'
import { stylesheet } from 'typestyle'
import { isIntersectingRect } from './image_annotator_rect'
import { eventToCursor } from './parts/annotator_utils'
import { MicroBars } from './parts/microbars'
import { AnnotatorTags } from './text_annotator'
import { cssVar, cssVarValue, rgb } from './theme'
import { wave } from './ui'

/** Create a unique tag type for use in an audio annotator. */
interface AudioAnnotatorTag {
  /** An identifying name for this tag. */
  name: Id
  /** Text to be displayed for the annotation. */
  label: S
  /** Hex or RGB color string to be used as the background color. */
  color: S
}

/** Create an annotator item with initial selected tags or no tags. */
interface AudioAnnotatorItem {
  /** The start of the audio annotation in seconds. */
  from: F
  /** The end of the audio annotation in seconds. */
  to: F
  /** The `name` of the audio annotator tag to refer to for the `label` and `color` of this item. */
  tag: S
}

/**
 * Create an audio annotator component.
 * 
 * This component allows annotating and labeling parts of audio file.
 */
export interface AudioAnnotator {
  /** An identifying name for this component. */
  name: Id
  /** The source of the audio. We advise using mp3 or wav formats to achieve the best cross-browser experience. See https://caniuse.com/?search=audio%20format for other formats. */
  src: S
  /** The master list of tags that can be used for annotations. */
  tags: AudioAnnotatorTag[]
  /** Annotations to display on the image, if any. */
  items?: AudioAnnotatorItem[]
  /** True if the form should be submitted as soon as an annotation is made. */
  trigger?: B
}

type CanvasAnnotator = {
  annotations: DrawnAudioAnnotatorItem[]
  onAnnotate: (annotation: DrawnAudioAnnotatorItem) => void
  activeTag: S
  tags: AudioAnnotatorTag[]
  percentPlayed: F
  duration: F
  skipToTime: (e: React.MouseEvent<HTMLCanvasElement>) => void
  focusAnnotation: (annotation: DrawnAudioAnnotatorItem) => void
}
type DrawnAudioAnnotatorItem = AudioAnnotatorItem & {
  canvasHeight: U,
  canvasY: U,
  isFocused?: B
}
type DraggedAnnotation = { from: U, to: U, dragging: B }
type TooltipProps = { title: S, range: S, top: U, left: U }
type TagColor = { transparent: S, color: S, label: S }

const
  WAVEFORM_HEIGHT = 200,
  MIN_ANNOTATION_WIDTH = 5,
  TOP_TOOLTIP_OFFSET = -75,
  LEFT_TOOLTIP_OFFSET = 25,
  TRACK_WIDTH = 5,
  css = stylesheet({
    body: {
      minHeight: 400,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center'
    },
    waveForm: {
      position: 'absolute',
      top: 0,
      width: '100%',
      height: WAVEFORM_HEIGHT,
      cursor: 'pointer'
    },
    annotatorContainer: {
      width: '100%',
      height: WAVEFORM_HEIGHT,
      position: 'relative',
      marginTop: 15
    },
    annotatorCanvas: {
      position: 'absolute',
      top: 0,
      width: '100%',
      height: WAVEFORM_HEIGHT,
      cursor: 'pointer'
    },
    tooltip: {
      position: 'absolute',
      display: 'none',
      zIndex: 1,
      padding: 15,
      background: cssVar('$card'),
      borderRadius: 2,
      userSelect: 'none',
      boxShadow: `${cssVar('$text1')} 0px 6.4px 14.4px 0px, ${cssVar('$text2')} 0px 1.2px 3.6px 0px`
    },
  }),
  formatTime = (secs: F) => {
    const hours = Math.floor(secs / 3600)
    const minutes = Math.floor(secs / 60) % 60
    const seconds = (secs % 60).toFixed(2)

    return [hours, minutes, seconds]
      .map(v => v < 10 ? "0" + v : v)
      .filter((v, i) => v !== "00" || i > 0)
      .join(":")
  },
  isAnnotationIntersecting = (a1: DrawnAudioAnnotatorItem, a2: DrawnAudioAnnotatorItem) => {
    return (a2.from >= a1.from && a2.from <= a1.to) || (a1.from >= a2.from && a1.from <= a2.to)
  },
  createAnnotation = (start: U, end: U, tag: S) => ({
    from: Math.min(start, end),
    to: Math.max(start, end),
    tag,
    canvasHeight: WAVEFORM_HEIGHT,
    canvasY: 0
  }),
  getIntersectedAnnotation = (annotations: DrawnAudioAnnotatorItem[], x: U, y: U) => {
    return annotations.find(a => isIntersectingRect(x, y, { x1: a.from, x2: a.to, y1: a.canvasY, y2: a.canvasHeight + a.canvasY }))
  },
  getCanvasDimensions = (intersections: DrawnAudioAnnotatorItem[], annotation: DrawnAudioAnnotatorItem, maxDepth?: U) => {
    const verticalIntersections = intersections
      .filter(a => a !== annotation && annotation.from >= a.from && annotation.from <= a.to)
      .sort((a, b) => a.canvasY - b.canvasY)
    let canvasY = 0
    let j = 0
    while (canvasY === verticalIntersections[j]?.canvasY) {
      canvasY += verticalIntersections[j].canvasHeight
      j++
    }
    const canvasHeight = maxDepth
      ? WAVEFORM_HEIGHT / maxDepth
      : Math.abs(canvasY - (verticalIntersections[j]?.canvasY || WAVEFORM_HEIGHT))
    return { canvasY, canvasHeight }
  },
  CanvasAnnotator = ({ onAnnotate, activeTag, tags, percentPlayed, skipToTime, annotations, focusAnnotation, duration }: CanvasAnnotator) => {
    const
      canvasRef = React.useRef<HTMLCanvasElement>(null),
      ctxRef = React.useRef<CanvasRenderingContext2D | null>(null),
      tmpAnnotation = React.useRef<DraggedAnnotation | undefined>(undefined),
      [tooltipProps, setTooltipProps] = React.useState<TooltipProps | null>(null),
      theme = Fluent.useTheme(),
      colorsMap = React.useMemo(() => new Map<S, TagColor>(tags.map(tag => {
        const [R, G, B] = rgb(cssVarValue(tag.color))
        return [tag.name, {
          transparent: `rgba(${R}, ${G}, ${B}, 0.5)`,
          color: cssVarValue(tag.color),
          label: tag.label
        }]
      })), [tags, theme]),
      getMaxDepth = (idx: U, annotation: DrawnAudioAnnotatorItem, currMax: U) => {
        // TODO: Super ugly perf-wise.
        let currmax = annotations.filter(a => annotation.from >= a.from && annotation.from <= a.to).length
        for (let j = idx + 1; annotations[j]?.from >= annotation?.from && annotations[j]?.from <= annotation?.to; j++) {
          currmax = Math.max(currmax, getMaxDepth(j, annotations[j], currMax + 1))
        }
        return currmax
      },
      recalculateAnnotations = () => {
        if (annotations.length < 2) return
        let currMaxDepth = 1
        for (let i = 0; i < annotations.length; i++) {
          const annotation = annotations[i]
          // TODO: Super ugly perf-wise.
          const intersections = annotations.filter(a => a !== annotation && isAnnotationIntersecting(a, annotation))
          const bottomIntersections = intersections.filter(a => a !== annotation && a.from >= annotation.from && a.from <= annotation.to).length
          // TODO: Add memoization.
          const maxDepth = getMaxDepth(i, annotation, 1)
          const shouldFillRemainingSpace = !bottomIntersections || maxDepth < currMaxDepth
          currMaxDepth = intersections.length ? Math.max(currMaxDepth, maxDepth) : 1

          const { canvasY, canvasHeight } = getCanvasDimensions(intersections, annotation, shouldFillRemainingSpace ? 0 : maxDepth)
          annotation.canvasY = canvasY
          annotation.canvasHeight = canvasHeight
        }
      },
      redrawAnnotations = () => {
        const canvas = canvasRef.current
        const ctx = ctxRef.current
        if (!ctx || !canvas) return
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        annotations.forEach(({ from, to, tag, canvasHeight, canvasY, isFocused }) => {
          ctx.fillStyle = colorsMap.get(tag)?.transparent || 'red'
          ctx.fillRect(from, canvasY, to - from, canvasHeight)
          if (isFocused) {
            ctx.strokeStyle = colorsMap.get(tag)?.color || 'red'
            ctx.lineWidth = 3
            ctx.strokeRect(from, canvasY, to - from, canvasHeight)
          }
        })

        if (tmpAnnotation.current) {
          const { from, to } = tmpAnnotation.current
          ctx.fillStyle = colorsMap.get(activeTag)?.transparent || 'red'
          ctx.fillRect(from, 0, to - from, WAVEFORM_HEIGHT)
        }

        // Draw track.
        const trackPosition = canvas.width * percentPlayed
        // TODO: Change to normal color.
        ctx.fillStyle = cssVarValue('$red')
        ctx.fillRect(trackPosition, 0, TRACK_WIDTH, WAVEFORM_HEIGHT)
      },
      onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (e.buttons !== 1) return // Accept left-click only.
        const canvas = canvasRef.current
        if (!canvas) return
        const from = eventToCursor(e, canvas.getBoundingClientRect()).cursor_x
        tmpAnnotation.current = { from, to: from, dragging: false }
      },
      onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current
        const ctx = ctxRef.current
        if (!ctx || !canvas) return

        const { cursor_x, cursor_y } = eventToCursor(e, canvas.getBoundingClientRect())
        const intersected = getIntersectedAnnotation(annotations, cursor_x, cursor_y)
        setTooltipProps(!intersected ? null : {
          title: colorsMap.get(intersected.tag)?.label || '',
          range: `${formatTime(intersected.from / canvas.width * duration)} - ${formatTime(intersected.to / canvas.width * duration)}`,
          top: cursor_y + TOP_TOOLTIP_OFFSET,
          left: cursor_x + LEFT_TOOLTIP_OFFSET
        })

        if (!tmpAnnotation.current || e.buttons !== 1) return

        const { from, to } = createAnnotation(tmpAnnotation.current.from, cursor_x, activeTag)
        tmpAnnotation.current = { from, to, dragging: true }
        redrawAnnotations()

        canvas.style.cursor = 'ew-resize'
        setTooltipProps({
          title: colorsMap.get(activeTag)!.label,
          range: `${formatTime(from / canvas.width * duration)} - ${formatTime(to / canvas.width * duration)}`,
          top: cursor_y + TOP_TOOLTIP_OFFSET,
          left: cursor_x + LEFT_TOOLTIP_OFFSET
        })
      },
      onMouseLeave = () => {
        redrawAnnotations()
        setTooltipProps(null)
      },
      onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current
        const ctx = ctxRef.current
        if (!canvas || !ctx) return

        annotations.forEach(a => a.isFocused = false)
        redrawAnnotations()

        const { cursor_x, cursor_y } = eventToCursor(e, canvas.getBoundingClientRect())
        if (!tmpAnnotation.current?.dragging) {
          const intersected = getIntersectedAnnotation(annotations, cursor_x, cursor_y)
          intersected ? focusAnnotation(intersected) : skipToTime(e)
          return
        }

        const annotationWidth = Math.abs(tmpAnnotation.current.from - cursor_x)
        if (annotationWidth < MIN_ANNOTATION_WIDTH) return

        onAnnotate(createAnnotation(tmpAnnotation.current.from, cursor_x, activeTag))
        tmpAnnotation.current = undefined
        redrawAnnotations()
        canvas.style.cursor = 'pointer'
      },
      init = () => {
        // Set correct canvas coordinate system from default 300:150 since we resize canvas using CSS.
        if (canvasRef.current) canvasRef.current.width = canvasRef.current.getBoundingClientRect().width
        // If canvas is not ready or didn't resize yet, try again later.
        if (!canvasRef.current || canvasRef.current.width === 300) return setTimeout(init, 300) as unknown as U
        ctxRef.current = canvasRef.current.getContext('2d')
      }

    React.useEffect(() => {
      const focused = annotations.find(a => a.isFocused)
      if (focused) {
        focused.tag = activeTag
        redrawAnnotations()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTag])
    React.useEffect(() => {
      recalculateAnnotations()
      redrawAnnotations()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [annotations])

    React.useEffect(() => {
      const timeout = init()
      return () => window.clearTimeout(timeout)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // eslint-disable-next-line react-hooks/exhaustive-deps
    React.useEffect(redrawAnnotations, [percentPlayed])

    return (
      <>
        <div
          className={css.tooltip}
          style={{ display: tooltipProps ? 'block' : 'none', left: tooltipProps?.left, top: tooltipProps?.top }}
        >
          <Fluent.Text variant='mediumPlus' block>{tooltipProps?.title}</Fluent.Text>
          <Fluent.Text variant='small'>{tooltipProps?.range}</Fluent.Text>
        </div>
        <canvas
          height={WAVEFORM_HEIGHT}
          className={css.annotatorCanvas}
          ref={canvasRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
          onClick={onClick}
        />
      </>
    )
  }

declare global {
  interface Window { webkitAudioContext: typeof window.AudioContext }
}
// Shim for AudioContext in Safari.
window.AudioContext = window.AudioContext || window.webkitAudioContext

export const XAudioAnnotator = ({ model }: { model: AudioAnnotator }) => {
  const
    [activeTag, setActiveTag] = React.useState(model.tags[0]?.name),
    [waveFormData, setWaveFormData] = React.useState<{ val: U, cat: U }[] | null>(null),
    [isPlaying, setIsPlaying] = React.useState(false),
    [duration, setDuration] = React.useState(0),
    [currentTime, setCurrentTime] = React.useState(0),
    [annotations, setAnnotations] = React.useState<DrawnAudioAnnotatorItem[]>([]),
    audioRef = React.useRef<HTMLAudioElement>(null),
    audioContextRef = React.useRef<AudioContext>(),
    gainNodeRef = React.useRef<GainNode>(),
    fetchedAudioUrlRef = React.useRef<S>(),
    audioPositionIntervalRef = React.useRef<U>(),
    activateTag = (tagName: S) => () => setActiveTag(tagName),
    // TODO: Move to a separate service worker.
    getAudioData = async () => {
      if (!audioRef.current) return

      const audioContext = new AudioContext()
      audioContextRef.current = audioContext
      gainNodeRef.current = audioContext.createGain()

      audioContext.createMediaElementSource(audioRef.current)
        .connect(gainNodeRef.current)
        .connect(audioContext.destination)

      // The data audio needs to be fetched and processed manually to generate a waveform later.
      const res = await fetch(model.src)
      const arrBuffer = await res.arrayBuffer()
      // Store the URL into the ref so that it can be revoked on destroy and mem leak prevented.
      fetchedAudioUrlRef.current = URL.createObjectURL(new Blob([arrBuffer]))
      // Do not set src directly within HTML to prevent double fetching.
      audioRef.current.src = fetchedAudioUrlRef.current

      const audioBuffer = await audioContext.decodeAudioData(arrBuffer)
      const rawData = audioBuffer.getChannelData(0) // We only need to work with one channel of data

      // TODO: Compute samples dynamically based on available width.
      const samples = 300
      const blockSize = Math.floor(rawData.length / samples)
      const filteredData = new Array(samples)
      for (let i = 0; i < samples; i++) {
        const blockStart = blockSize * i // the location of the first sample in the block
        let sum = 0
        for (let j = 0; j < blockSize; j++) {
          sum += Math.abs(rawData[blockStart + j]) // find the sum of all the samples in the block
        }
        filteredData[i] = sum / blockSize // divide the sum by the block size to get the average
      }
      const multiplier = Math.pow(Math.max(...filteredData), -1)
      setWaveFormData(filteredData.map(n => ({ val: n * multiplier, cat: n * multiplier * 100 })))
      setDuration(audioBuffer.duration)
    },
    onPlayerStateChange = () => {
      const audioContext = audioContextRef.current
      const audioEl = audioRef.current
      if (!audioContext || !audioEl) return
      if (audioContext.state === 'suspended') audioContext.resume()

      if (isPlaying) {
        audioEl.pause()
        if (audioPositionIntervalRef.current) window.clearInterval(audioPositionIntervalRef.current)
      }
      else {
        audioEl.play()
        // We need higher frequency than HTMLAudioELEMENT's onTimeUpdate provides.
        // TODO: Think about whether requestAnimationFrame would make more sense here.
        audioPositionIntervalRef.current = window.setInterval(() => setCurrentTime(audioEl.currentTime), 10)
      }
      setIsPlaying(isPlaying => !isPlaying)
    },
    onAudioEnded = () => {
      setIsPlaying(false)
      if (audioPositionIntervalRef.current) window.clearInterval(audioPositionIntervalRef.current)
    },
    onVolumeChange = (v: U) => { if (gainNodeRef.current) gainNodeRef.current.gain.value = v },
    onSpeedChange = (v: U) => { if (audioRef.current) audioRef.current.playbackRate = v },
    skipToTime = (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!audioRef.current) return
      const xRelativeToCurrTarget = e.pageX - e.currentTarget.getBoundingClientRect().left
      const newTime = xRelativeToCurrTarget / e.currentTarget.clientWidth * duration
      setCurrentTime(newTime)
      audioRef.current.currentTime = newTime
    },
    onAnnotate = (newAnnotation: DrawnAudioAnnotatorItem) => {
      setAnnotations(prev => {
        const newAnnotations = [...prev, newAnnotation]
        newAnnotations.sort((a, b) => a.from - b.from)
        wave.args[model.name] = newAnnotations as unknown as Rec[]
        return newAnnotations
      })
    },
    reset = () => setAnnotations([]),
    removeAnnotation = () => setAnnotations(prev => prev.filter(a => !a.isFocused)),
    focusAnnotation = (annotation: DrawnAudioAnnotatorItem) => {
      if (annotation.tag !== activeTag) setActiveTag(annotation.tag)
      setAnnotations(prev => prev.map(a => {
        a.isFocused = a === annotation
        return a
      }))
    }

  React.useEffect(() => {
    getAudioData()
    wave.args[model.name] = (model.items as unknown as Rec[]) || []
    return () => {
      if (fetchedAudioUrlRef.current) URL.revokeObjectURL(fetchedAudioUrlRef.current)
      if (audioPositionIntervalRef.current) window.clearInterval(audioPositionIntervalRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div data-test={model.name} className={css.body}>
      <audio hidden ref={audioRef} onEnded={onAudioEnded}></audio>
      {
        waveFormData ? (
          <>
            <AnnotatorTags tags={model.tags} activateTag={activateTag} activeTag={activeTag} />
            <div className={css.annotatorContainer}>
              <MicroBars data={waveFormData} value='val' category='cat' color='$themePrimary' zeroValue={0} />
              <CanvasAnnotator
                annotations={annotations}
                onAnnotate={onAnnotate}
                activeTag={activeTag}
                tags={model.tags}
                percentPlayed={currentTime / duration}
                duration={duration}
                skipToTime={skipToTime}
                focusAnnotation={focusAnnotation}
              />
            </div>
            <Fluent.Slider label='Speed' min={0} defaultValue={1} max={2} step={0.01} onChange={onSpeedChange} />
            <Fluent.Slider label='Volume' min={0} defaultValue={1} max={2} step={0.01} onChange={onVolumeChange} />
            <Fluent.IconButton iconProps={{ iconName: isPlaying ? 'Pause' : 'Play' }} onClick={onPlayerStateChange} />
            <div>{formatTime(currentTime)} / {formatTime(duration)}</div>
            <Fluent.IconButton iconProps={{ iconName: 'Reset' }} onClick={reset} />
            <Fluent.IconButton iconProps={{ iconName: 'Delete' }} onClick={removeAnnotation} disabled={annotations.every(a => !a.isFocused)} />
          </>
        ) : <Fluent.Spinner size={Fluent.SpinnerSize.large} label='Loading audio annotator' />
      }
    </div >
  )
}