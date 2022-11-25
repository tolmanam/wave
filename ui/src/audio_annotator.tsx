import * as Fluent from '@fluentui/react'
import { IDropdownOption } from '@fluentui/react'
import { B, F, Id, Rec, S, U } from 'h2o-wave'
import React from 'react'
import { stylesheet } from 'typestyle'
import { isIntersectingRect } from './image_annotator_rect'
import { eventToCursor } from './parts/annotator_utils'
import { MicroBars } from './parts/microbars'
import { AnnotatorTags } from './text_annotator'
import { clas, cssVar, cssVarValue } from './theme'
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
  start: F
  /** The end of the audio annotation in seconds. */
  end: F
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
  name: Id,
  /** The audio annotator's title. */
  title: S
  /** The source of the audio. We advise using mp3 or wav formats to achieve the best cross-browser experience. See https://caniuse.com/?search=audio%20format for other formats. */
  src: S
  /** The master list of tags that can be used for annotations. */
  tags: AudioAnnotatorTag[]
  /** Annotations to display on the image, if any. */
  items?: AudioAnnotatorItem[]
  /** True if the form should be submitted as soon as an annotation is made. */
  trigger?: B
}

type RangeAnnotator = {
  annotations: DrawnAudioAnnotatorItem[]
  onAnnotate: (annotation?: DrawnAudioAnnotatorItem) => void
  activeTag: S
  tags: AudioAnnotatorTag[]
  percentPlayed: F
  duration: F
  skipToTime: (e: React.MouseEvent<HTMLCanvasElement>) => void
  focusAnnotation: (annotation: DrawnAudioAnnotatorItem) => void
}
type DrawnAudioAnnotatorItem = AudioAnnotatorItem & {
  canvasStart: F
  canvasEnd: F
  canvasHeight: U
  canvasY: U
  isFocused?: B
}
type DraggedAnnotation = {
  from: U
  to: U
  action?: 'resize' | 'move' | 'new'
  resized?: 'from' | 'to'
  intersected?: DrawnAudioAnnotatorItem
}
type TooltipProps = { title: S, range: S, top: U, left: U }
type TagColor = { transparent: S, color: S, label: S }

const
  WAVEFORM_HEIGHT = 200,
  MIN_ANNOTATION_WIDTH = 5,
  ANNOTATION_HANDLE_OFFSET = 3,
  TOP_TOOLTIP_OFFSET = -75,
  LEFT_TOOLTIP_OFFSET = 25,
  TOOLTIP_WIDTH = 200,
  TRACK_WIDTH = 5,
  css = stylesheet({
    body: {
      minHeight: 400,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center'
    },
    title: {
      color: cssVar('$neutralPrimary'),
      marginBottom: 8
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
      width: TOOLTIP_WIDTH,
      borderRadius: 2,
      userSelect: 'none',
      boxShadow: `${cssVar('$text1')} 0px 6.4px 14.4px 0px, ${cssVar('$text2')} 0px 1.2px 3.6px 0px`,
      boxSizing: 'border-box',
    },
    controlBarItem: {
      flex: 1,
      display: 'flex'
    }
  }),
  speedAdjustmentOptions = [
    { key: 0.25, text: '0.25x' },
    { key: 0.5, text: '0.5x' },
    { key: 0.75, text: '0.75x' },
    { key: 1, text: 'Normal' },
    { key: 1.25, text: '1.25x' },
    { key: 1.5, text: '1.5x' },
    { key: 2, text: '2x' },
  ],
  formatTime = (secs: F) => {
    const hours = Math.floor(secs / 3600)
    const minutes = Math.floor(secs / 60) % 60
    const seconds = (secs % 60).toFixed(2)

    return [hours, minutes, seconds]
      .map(v => v < 10 ? "0" + v : v)
      .filter((v, i) => v !== "00" || i > 0)
      .join(":")
  },
  getIntersectingEdge = (x: U, intersected?: DrawnAudioAnnotatorItem) => {
    if (!intersected) return
    const { canvasStart, canvasEnd } = intersected
    if (Math.abs(canvasStart - x) <= ANNOTATION_HANDLE_OFFSET) return 'from'
    if (Math.abs(canvasEnd - x) <= ANNOTATION_HANDLE_OFFSET) return 'to'
  },
  getResized = (cursor_x: F, min: F, max: F) => {
    return cursor_x === min
      ? 'from'
      : cursor_x === max
        ? 'to'
        : undefined
  },
  getTooltipLeftOffset = (cursorX: F, canvasWidth: F) => {
    return (cursorX + TOOLTIP_WIDTH + LEFT_TOOLTIP_OFFSET) > canvasWidth
      ? cursorX - TOOLTIP_WIDTH - LEFT_TOOLTIP_OFFSET
      : cursorX + LEFT_TOOLTIP_OFFSET
  },
  isAnnotationIntersecting = (a1: DrawnAudioAnnotatorItem, a2: DrawnAudioAnnotatorItem) => {
    const { start: start1, end: end1 } = a1
    const { start: start2, end: end2 } = a2
    return (start2 >= start1 && start2 <= end1) || (start1 >= start2 && start1 <= end2)
  },
  canvasUnitsToSeconds = (canvasUnit: F, canvasWidth: F, duration: F) => +(canvasUnit / canvasWidth * duration).toFixed(2),
  createAnnotation = (from: U, to: U, tag: S, canvasWidth: F, duration: F): DrawnAudioAnnotatorItem => {
    const canvasStart = Math.min(from, to)
    const canvasEnd = Math.max(from, to)
    const start = canvasUnitsToSeconds(from, canvasWidth, duration)
    const end = canvasUnitsToSeconds(to, canvasWidth, duration)
    return { canvasStart, canvasEnd, start, end, tag, canvasHeight: WAVEFORM_HEIGHT, canvasY: 0 }
  },
  getIntersectedAnnotation = (annotations: DrawnAudioAnnotatorItem[], x: U, y: U) => {
    return annotations.find(a => isIntersectingRect(x, y, { x1: a.canvasStart, x2: a.canvasEnd, y1: a.canvasY, y2: a.canvasHeight + a.canvasY }))
  },
  getCanvasDimensions = (intersections: DrawnAudioAnnotatorItem[], annotation: DrawnAudioAnnotatorItem, maxDepth?: U) => {
    const verticalIntersections = intersections
      .filter(a => a !== annotation && annotation.canvasStart >= a.canvasStart && annotation.canvasStart <= a.canvasEnd)
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
  RangeAnnotator = ({ onAnnotate, activeTag, tags, percentPlayed, skipToTime, annotations, focusAnnotation, duration }: RangeAnnotator) => {
    const
      canvasRef = React.useRef<HTMLCanvasElement>(null),
      ctxRef = React.useRef<CanvasRenderingContext2D | null>(null),
      currDrawnAnnotation = React.useRef<DraggedAnnotation | undefined>(undefined),
      isDefaultCanvasWidthFixed = React.useRef(false),
      [tooltipProps, setTooltipProps] = React.useState<TooltipProps | null>(null),
      theme = Fluent.useTheme(),
      colorsMap = React.useMemo(() => new Map<S, TagColor>(tags.map(tag => {
        const color = Fluent.getColorFromString(cssVarValue(tag.color))
        return [tag.name, {
          transparent: color ? `rgba(${color.r}, ${color.g}, ${color.b}, 0.5)` : cssVarValue(tag.color),
          color: cssVarValue(tag.color),
          label: tag.label
        }]
        // eslint-disable-next-line react-hooks/exhaustive-deps
      })), [tags, theme]),
      getMaxDepth = React.useCallback((idx: U, annotation: DrawnAudioAnnotatorItem, currMax: U) => {
        // TODO: Super ugly perf-wise.
        let currmax = annotations.filter(a => annotation.canvasStart >= a.canvasStart && annotation.canvasStart <= a.canvasEnd).length
        for (let j = idx + 1; annotations[j]?.canvasStart >= annotation?.canvasStart && annotations[j]?.canvasStart <= annotation?.canvasEnd; j++) {
          currmax = Math.max(currmax, getMaxDepth(j, annotations[j], currMax + 1))
        }
        return currmax
      }, [annotations]),
      recalculateAnnotations = React.useCallback(() => {
        let currMaxDepth = 1
        for (let i = 0; i < annotations.length; i++) {
          const annotation = annotations[i]
          // TODO: Super ugly perf-wise.
          const intersections = annotations.filter(a => a !== annotation && isAnnotationIntersecting(a, annotation))
          const bottomIntersections = intersections.filter(a => a !== annotation && a.canvasStart >= annotation.canvasStart && a.canvasStart <= annotation.canvasEnd).length
          // TODO: Add memoization.
          const maxDepth = getMaxDepth(i, annotation, 1)
          const shouldFillRemainingSpace = !bottomIntersections || maxDepth < currMaxDepth
          currMaxDepth = intersections.length ? Math.max(currMaxDepth, maxDepth) : 1

          const { canvasY, canvasHeight } = getCanvasDimensions(intersections, annotation, shouldFillRemainingSpace ? 0 : maxDepth)
          annotation.canvasY = canvasY
          annotation.canvasHeight = canvasHeight
        }
      }, [annotations, getMaxDepth]),
      redrawAnnotations = React.useCallback(() => {
        const canvas = canvasRef.current
        const ctx = ctxRef.current
        if (!ctx || !canvas) return
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        annotations.forEach(({ canvasStart, canvasEnd, tag, canvasHeight, canvasY, isFocused }) => {
          ctx.fillStyle = colorsMap.get(tag)?.transparent || 'red'
          ctx.fillRect(canvasStart, canvasY, canvasEnd - canvasStart, canvasHeight)
          if (isFocused) {
            ctx.strokeStyle = colorsMap.get(tag)?.color || 'red'
            ctx.lineWidth = 3
            ctx.strokeRect(canvasStart, canvasY, canvasEnd - canvasStart, canvasHeight)
          }
        })

        if (currDrawnAnnotation.current && currDrawnAnnotation.current.action === 'new') {
          const { from, to } = currDrawnAnnotation.current
          ctx.fillStyle = colorsMap.get(activeTag)?.transparent || 'red'
          ctx.fillRect(from, 0, to - from, WAVEFORM_HEIGHT)
        }

        // Draw track.
        const trackPosition = canvas.width * percentPlayed
        ctx.fillStyle = cssVarValue('$themeDark')
        ctx.fillRect(trackPosition, 0, TRACK_WIDTH, WAVEFORM_HEIGHT)
      }, [activeTag, annotations, colorsMap, percentPlayed]),
      onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (e.buttons !== 1) return // Accept left-click only.
        const canvas = canvasRef.current
        if (!canvas) return
        const { cursor_x, cursor_y } = eventToCursor(e, canvas.getBoundingClientRect())
        const intersected = getIntersectedAnnotation(annotations, cursor_x, cursor_y)
        const resized = getIntersectingEdge(cursor_x, intersected)
        const action = intersected?.isFocused ? (resized && 'resize') || 'move' : undefined
        currDrawnAnnotation.current = { from: cursor_x, to: cursor_x, action, intersected, resized }
      },
      onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current
        const ctx = ctxRef.current
        if (!ctx || !canvas) return

        const canvasWidth = canvasRef.current.width
        const { cursor_x, cursor_y } = eventToCursor(e, canvas.getBoundingClientRect())
        const intersected = getIntersectedAnnotation(annotations, cursor_x, cursor_y)
        setTooltipProps(!intersected ? null : {
          title: colorsMap.get(intersected.tag)?.label || '',
          range: `${formatTime(intersected.start)} - ${formatTime(intersected.end)}`,
          top: cursor_y + TOP_TOOLTIP_OFFSET,
          left: getTooltipLeftOffset(cursor_x, canvasWidth)
        })

        canvas.style.cursor = intersected?.isFocused
          ? getIntersectingEdge(cursor_x, intersected) ? 'ew-resize' : 'move'
          : 'pointer'

        if (currDrawnAnnotation.current && !currDrawnAnnotation.current?.action && e.buttons === 1) {
          currDrawnAnnotation.current.action = 'new'
        }
        else if (!currDrawnAnnotation.current || e.buttons !== 1) return

        let tooltipFrom = 0
        let tooltipTo = 0
        const { action, intersected: currIntersected } = currDrawnAnnotation.current
        if (action === 'new') {
          const { from, to, resized } = currDrawnAnnotation.current
          const min = Math.min(from, to, cursor_x)
          const max = Math.max(from, to, cursor_x)
          const start = resized === 'from' ? cursor_x : min
          const end = resized === 'to' ? cursor_x : max
          tooltipFrom = start
          tooltipTo = end
          currDrawnAnnotation.current = { from: start, to: end, action: 'new' }
          currDrawnAnnotation.current.resized = getResized(cursor_x, min, max) || currDrawnAnnotation.current.resized
          canvas.style.cursor = 'ew-resize'
        }
        else if (action === 'move' && currIntersected) {
          const movedOffset = cursor_x - currDrawnAnnotation.current.from
          const newCanvasStart = currIntersected.canvasStart + movedOffset
          const newCanvasEnd = currIntersected.canvasEnd + movedOffset
          if (newCanvasStart >= 0 && newCanvasEnd <= canvasWidth) {
            currIntersected.canvasStart = newCanvasStart
            currIntersected.canvasEnd = newCanvasEnd
            currIntersected.start = canvasUnitsToSeconds(newCanvasStart, canvasWidth, duration)
            currIntersected.end = canvasUnitsToSeconds(newCanvasEnd, canvasWidth, duration)
          }
          tooltipFrom = currIntersected.canvasStart
          tooltipTo = currIntersected.canvasEnd
          currDrawnAnnotation.current.from += movedOffset
          canvas.style.cursor = 'move'
        }
        else if (action === 'resize' && currIntersected) {
          const { resized } = currDrawnAnnotation.current
          const canvasWidth = canvasRef.current.width
          if (resized === 'from') {
            currIntersected.canvasStart = Math.max(cursor_x, 0)
            currIntersected.start = canvasUnitsToSeconds(currIntersected.canvasStart, canvasWidth, duration)
          }
          else if (resized === 'to') {
            currIntersected.canvasEnd = Math.min(cursor_x, canvasWidth)
            currIntersected.end = canvasUnitsToSeconds(currIntersected.canvasEnd, canvasWidth, duration)
          }

          const min = Math.min(currIntersected.canvasStart, currIntersected.canvasEnd, cursor_x)
          const max = Math.max(currIntersected.canvasStart, currIntersected.canvasEnd, cursor_x)
          currDrawnAnnotation.current.resized = getResized(cursor_x, min, max) || currDrawnAnnotation.current.resized

          tooltipFrom = min
          tooltipTo = max
          canvas.style.cursor = 'ew-resize'
        }

        redrawAnnotations()
        setTooltipProps({
          title: colorsMap.get(activeTag)!.label,
          range: `${formatTime(tooltipFrom / canvas.width * duration)} - ${formatTime(tooltipTo / canvas.width * duration)}`,
          top: cursor_y + TOP_TOOLTIP_OFFSET,
          left: getTooltipLeftOffset(cursor_x, canvasWidth)
        })
      },
      onMouseLeave = () => {
        currDrawnAnnotation.current = undefined
        redrawAnnotations()
        setTooltipProps(null)
      },
      onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current
        const ctx = ctxRef.current
        if (!canvas || !ctx) return

        const action = currDrawnAnnotation.current?.action
        if (!action || action === 'new') {
          annotations.forEach(a => a.isFocused = false)
          redrawAnnotations()
        }

        const { cursor_x, cursor_y } = eventToCursor(e, canvas.getBoundingClientRect())
        const intersected = getIntersectedAnnotation(annotations, cursor_x, cursor_y)

        canvas.style.cursor = intersected
          ? getIntersectingEdge(cursor_x, intersected) ? 'ew-resize' : 'move'
          : 'pointer'

        if (!currDrawnAnnotation.current || !action) {
          intersected ? focusAnnotation(intersected) : skipToTime(e)
          return
        }

        let newAnnotation
        if (action === 'new') {
          const { from, to } = currDrawnAnnotation.current
          const annotationWidth = Math.abs(from - to)
          if (annotationWidth < MIN_ANNOTATION_WIDTH) return
          newAnnotation = createAnnotation(from, to, activeTag, canvasRef.current.width, duration)
        }
        else if (action === 'resize') {
          const resized = currDrawnAnnotation.current.intersected
          if (resized) {
            const { canvasStart, canvasEnd } = resized
            resized.canvasStart = Math.min(canvasStart, canvasEnd)
            resized.canvasEnd = Math.max(canvasStart, canvasEnd)
            resized.start = canvasUnitsToSeconds(resized.canvasStart, canvasRef.current.width, duration)
            resized.end = canvasUnitsToSeconds(resized.canvasEnd, canvasRef.current.width, duration)
          }
        }
        onAnnotate(newAnnotation)

        currDrawnAnnotation.current = undefined
        if (action === 'move' || action === 'resize') recalculateAnnotations()
        redrawAnnotations()
      },
      init = React.useCallback((): U | undefined => {
        // Set correct canvas coordinate system from default 300:150 since we resize canvas using CSS.
        if (canvasRef.current) {
          canvasRef.current.width = canvasRef.current.getBoundingClientRect().width
          ctxRef.current = canvasRef.current.getContext('2d')
          isDefaultCanvasWidthFixed.current = true
          recalculateAnnotations()
          redrawAnnotations()
        }
        // If canvas is not ready or didn't resize yet, try again later.
        if (!canvasRef.current || !isDefaultCanvasWidthFixed.current) return setTimeout(init, 300) as unknown as U
      }, [recalculateAnnotations, redrawAnnotations])

    React.useEffect(() => {
      window.addEventListener('resize', init)
      return () => window.removeEventListener('resize', init)
    }, [init])

    React.useEffect(() => {
      if (!isDefaultCanvasWidthFixed.current) return
      const focused = annotations.find(a => a.isFocused)
      if (focused) focused.tag = activeTag
      recalculateAnnotations()
      redrawAnnotations()
    }, [activeTag, annotations, recalculateAnnotations, redrawAnnotations])

    React.useEffect(() => {
      const timeout = init()
      return () => window.clearTimeout(timeout)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return (
      <>
        <div
          data-test='audio-annotator-tooltip'
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

const itemsToAnnotations = (items?: AudioAnnotatorItem[]) => (items || []).map(i => (
  { ...i, canvasHeight: 0, canvasY: 0, canvasStart: i.start, canvasEnd: i.end }
))

export const XAudioAnnotator = ({ model }: { model: AudioAnnotator }) => {
  const
    [activeTag, setActiveTag] = React.useState(model.tags[0]?.name),
    [waveFormData, setWaveFormData] = React.useState<{ val: U, cat: U }[] | null>(null),
    [isPlaying, setIsPlaying] = React.useState(false),
    [duration, setDuration] = React.useState(0),
    [currentTime, setCurrentTime] = React.useState(0),
    [annotations, setAnnotations] = React.useState<DrawnAudioAnnotatorItem[]>(itemsToAnnotations(model.items)),
    [volumeIcon, setVolumeIcon] = React.useState('Volume3'),
    audioRef = React.useRef<HTMLAudioElement>(null),
    audioContextRef = React.useRef<AudioContext>(),
    gainNodeRef = React.useRef<GainNode>(),
    fetchedAudioUrlRef = React.useRef<S>(),
    audioPositionIntervalRef = React.useRef<U>(),
    setWaveArgs = (annotations: DrawnAudioAnnotatorItem[]) => {
      wave.args[model.name] = annotations.map(({ start, end, tag }) => ({ start, end, tag })) as unknown as Rec[]
      if (model.trigger) wave.push()
    },
    activateTag = (tagName: S) => () => {
      setActiveTag(tagName)
      setAnnotations(prev => {
        const newAnnotations = prev.map(a => { if (a.isFocused) a.tag = tagName; return a })
        setWaveArgs(newAnnotations)
        return newAnnotations
      })
    },
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
    onPlaybackResume = () => {
      if (isPlaying) onPlayerStateChange()
      setCurrentTime(0)
      if (audioRef.current) audioRef.current.currentTime = 0
    },
    onVolumeChange = (v: U) => {
      if (gainNodeRef.current) gainNodeRef.current.gain.value = v
      setVolumeIcon(v === 0 ? 'VolumeDisabled' : (v < 0.3 ? 'Volume1' : (v < 0.75 ? 'Volume2' : 'Volume3')))
    },
    onSpeedChange = (v: U) => { if (audioRef.current) audioRef.current.playbackRate = v },
    skipToTime = (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!audioRef.current) return
      const xRelativeToCurrTarget = (e.pageX || 0) - e.currentTarget.getBoundingClientRect().left
      const newTime = xRelativeToCurrTarget / e.currentTarget.width * duration
      setCurrentTime(newTime)
      audioRef.current.currentTime = newTime
    },
    onAnnotate = (newAnnotation?: DrawnAudioAnnotatorItem) => {
      setAnnotations(prev => {
        const newAnnotations = newAnnotation ? [...prev, newAnnotation] : prev
        newAnnotations.sort((a, b) => a.start - b.start)
        setWaveArgs(newAnnotations)
        return newAnnotations
      })
    },
    reset = () => {
      setAnnotations([])
      setWaveArgs([])
    },
    removeAnnotation = () => {
      setAnnotations(prev => {
        const newAnnotations = prev.filter(a => !a.isFocused)
        setWaveArgs(newAnnotations)
        return newAnnotations
      })
    },
    focusAnnotation = (annotation: DrawnAudioAnnotatorItem) => {
      if (annotation.tag !== activeTag) setActiveTag(annotation.tag)
      setAnnotations(prev => prev.map(a => { a.isFocused = a === annotation; return a }))
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
      <div className={clas('wave-s16 wave-w6', css.title)}>{model.title}</div>
      <audio hidden ref={audioRef} onEnded={onAudioEnded}></audio>
      {
        waveFormData ? (
          <>
            <AnnotatorTags tags={model.tags} activateTag={activateTag} activeTag={activeTag} />
            <Fluent.CommandBar styles={{ root: { padding: 0 } }} items={[
              {
                key: 'remove-all',
                text: 'Remove all',
                onClick: reset,
                disabled: annotations.length === 0,
                iconProps: { iconName: 'DependencyRemove', styles: { root: { fontSize: 20 } } },
              },
              {
                key: 'remove',
                text: 'Remove selected',
                onClick: removeAnnotation,
                disabled: annotations.every(a => !a.isFocused),
                iconProps: { iconName: 'Delete', styles: { root: { fontSize: 20 } } },
              },
            ]}
            />
            <div className={css.annotatorContainer}>
              <MicroBars data={waveFormData} value='val' category='cat' color='$themePrimary' zeroValue={0} />
              <RangeAnnotator
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
            <div style={{ display: 'flex' }}>
              <div className={css.controlBarItem} style={{ justifyContent: 'flex-start' }}>
                <Fluent.Icon iconName={volumeIcon} styles={{ root: { fontSize: 18 } }} />
                <Fluent.Slider styles={{ root: { minWidth: 180 } }} min={0} defaultValue={1} max={2} step={0.01} onChange={onVolumeChange} valueFormat={v => `${Math.round(v * 100)}%`} />
                <Fluent.Icon iconName={'PlaybackRate1x'} styles={{ root: { marginTop: 3, marginLeft: 6, fontSize: 18 } }} />
                <Fluent.Dropdown
                  title='Playback speed'
                  styles={{ title: { border: 'none', }, dropdown: { selectors: { ':focus::after': { border: 'none' } }, minWidth: 70 } }}
                  defaultSelectedKey={audioRef?.current?.playbackRate || 1}
                  options={speedAdjustmentOptions}
                  onChange={(_ev, option: IDropdownOption | undefined) => onSpeedChange(option!.key as number)}
                />
              </div>
              <div className={css.controlBarItem} style={{ justifyContent: 'center', marginTop: 12 }}>
                <Fluent.IconButton iconProps={{ iconName: 'PlayReverseResume' }} styles={{ icon: { fontSize: 18 } }} onClick={onPlaybackResume} />
                <Fluent.IconButton
                  iconProps={{ iconName: isPlaying ? 'Pause' : 'PlaySolid' }}
                  onClick={onPlayerStateChange}
                  styles={{
                    // marginRight 24 centers the play button - it is the width of the PlayReverseResume button.
                    root: { backgroundColor: cssVar('$themePrimary'), borderRadius: 50, marginRight: 24 },
                    rootHovered: { backgroundColor: cssVar('$themeSecondary') },
                    icon: { marginBottom: 2, color: cssVar('$white'), fontSize: 18 }
                  }}
                />
              </div>
              <div className={css.controlBarItem} style={{ justifyContent: 'flex-end', marginTop: 4 }}>
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
            </div>
          </>
        ) : <Fluent.Spinner size={Fluent.SpinnerSize.large} label='Loading audio annotator' />
      }
    </div >
  )
}