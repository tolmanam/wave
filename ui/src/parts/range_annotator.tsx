import { css } from '@fluentui/react'
import { TooltipProps } from '@mui/material'
import { S, F, U } from 'h2o-wave'
import React from 'react'
import { cssVarValue } from '../theme'
import { eventToCursor } from './annotator_utils'

type RangeAnnotator = {
  onAnnotate: (annotations: DrawnAnnotation[]) => void
  activeTag: S
  tags: AudioAnnotatorTag[]
  percentPlayed: F
  duration: F
  setActiveTag: (tag: S) => void
  items?: AudioAnnotatorItem[]
  onRenderToolbar?: () => JSX.Element
}
type DraggedAnnotation = {
  from: U
  to: U
  action?: 'resize' | 'move' | 'new'
  resized?: 'from' | 'to'
  intersected?: DrawnAnnotation
}
type TooltipProps = { title: S, range: S, top: U, left: U }
type TagColor = { transparent: S, color: S, label: S }

export const RangeAnnotator = (props: React.PropsWithChildren<RangeAnnotator>) => {
  const
    { onAnnotate, activeTag, tags, percentPlayed, items, duration, setActiveTag, children, onRenderToolbar } = props,
    canvasRef = React.useRef<HTMLCanvasElement>(null),
    ctxRef = React.useRef<CanvasRenderingContext2D | null>(null),
    currDrawnAnnotation = React.useRef<DraggedAnnotation | undefined>(undefined),
    isDefaultCanvasWidthFixed = React.useRef(false),
    [tooltipProps, setTooltipProps] = React.useState<TooltipProps | null>(null),
    [removeAllDisabled, setRemoveAllDisabled] = React.useState(!items?.length),
    [removeDisabled, setRemoveDisabled] = React.useState(true),
    annotationsRef = React.useRef<DrawnAnnotation[]>(itemsToAnnotations(items)),
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
    recalculateAnnotations = React.useCallback((submit = false) => {
      const annotations = annotationsRef.current
      const mergedAnnotations: DrawnAnnotation[] = []
      const visited = new Set()
      for (let i = 0; i < annotations.length; i++) {
        const currAnnotation = annotations[i]
        if (visited.has(currAnnotation)) continue
        mergedAnnotations.push(currAnnotation)

        for (let j = i + 1; j < annotations.length; j++) {
          const nextAnnotation = annotations[j]
          if (currAnnotation.tag !== nextAnnotation.tag) continue
          if (!isAnnotationIntersectingAtEnd(currAnnotation, nextAnnotation)) break
          currAnnotation.end = Math.max(currAnnotation.end, nextAnnotation.end)
          currAnnotation.canvasEnd = Math.max(currAnnotation.canvasEnd, nextAnnotation.canvasEnd)
          visited.add(nextAnnotation)
        }
      }

      let currMaxDepth = 1
      for (let i = 0; i < mergedAnnotations.length; i++) {
        const annotation = mergedAnnotations[i]
        const nextIntersections = []
        const prevIntersections = []
        for (let j = i - 1; isAnnotationIntersectingAtStart(mergedAnnotations[j], annotation); j--) {
          prevIntersections.push(mergedAnnotations[j])
        }
        for (let j = i + 1; isAnnotationIntersectingAtEnd(annotation, mergedAnnotations[j]); j++) {
          nextIntersections.push(mergedAnnotations[j])
        }

        const intersections = [...prevIntersections, ...nextIntersections]
        const maxDepth = getMaxDepth(mergedAnnotations, i, annotation, 1)
        const shouldFillRemainingSpace = !nextIntersections.length || maxDepth < currMaxDepth
        currMaxDepth = intersections.length ? Math.max(currMaxDepth, maxDepth) : 1

        const { canvasY, canvasHeight } = getCanvasDimensions(intersections, annotation, shouldFillRemainingSpace ? 0 : maxDepth)
        annotation.canvasY = canvasY
        annotation.canvasHeight = canvasHeight
      }
      if (submit) onAnnotate(mergedAnnotations)
      annotationsRef.current = mergedAnnotations
    }, [onAnnotate]),
    redrawAnnotations = React.useCallback(() => {
      const canvas = canvasRef.current
      const ctx = ctxRef.current
      if (!ctx || !canvas) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      annotationsRef.current.forEach(({ canvasStart, canvasEnd, tag, canvasHeight, canvasY, isFocused }) => {
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
      const trackPosition = percentPlayed === 1 ? canvas.width - TRACK_WIDTH : canvas.width * percentPlayed
      ctx.fillStyle = cssVarValue('$themeDark')
      ctx.fillRect(trackPosition - (TRACK_WIDTH / 2), 0, TRACK_WIDTH, WAVEFORM_HEIGHT)
    }, [activeTag, colorsMap, percentPlayed]),
    onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.buttons !== 1) return // Accept left-click only.
      const canvas = canvasRef.current
      if (!canvas) return
      const { cursor_x, cursor_y } = eventToCursor(e, canvas.getBoundingClientRect())
      const intersected = getIntersectedAnnotation(annotationsRef.current, cursor_x, cursor_y)
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
      const intersected = getIntersectedAnnotation(annotationsRef.current, cursor_x, cursor_y)
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
        annotationsRef.current.forEach(a => a.isFocused = false)
        setRemoveDisabled(true)
        redrawAnnotations()
      }

      const { cursor_x, cursor_y } = eventToCursor(e, canvas.getBoundingClientRect())
      const intersected = getIntersectedAnnotation(annotationsRef.current, cursor_x, cursor_y)

      canvas.style.cursor = intersected
        ? getIntersectingEdge(cursor_x, intersected) ? 'ew-resize' : 'move'
        : 'pointer'

      if (!currDrawnAnnotation.current || !action) {
        if (intersected && intersected.tag !== activeTag) setActiveTag(intersected.tag)
        if (intersected) {
          annotationsRef.current.forEach(a => a.isFocused = a === intersected)
          setRemoveDisabled(false)
        }
        redrawAnnotations()
        return
      }

      if (action === 'new') {
        const { from, to } = currDrawnAnnotation.current
        const annotationWidth = Math.abs(from - to)
        if (annotationWidth < MIN_ANNOTATION_WIDTH) return
        annotationsRef.current.push(createAnnotation(from, to, activeTag, canvasRef.current.width, duration))
        annotationsRef.current.sort((a, b) => a.start - b.start)
        recalculateAnnotations(true)
        setRemoveAllDisabled(false)
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

      currDrawnAnnotation.current = undefined
      if (action === 'move' || action === 'resize') recalculateAnnotations(true)
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
    }, [recalculateAnnotations, redrawAnnotations]),
    reset = () => {
      annotationsRef.current = []
      onAnnotate([])
      redrawAnnotations()
      setRemoveDisabled(true)
      setRemoveAllDisabled(true)
    },
    removeAnnotation = () => {
      annotationsRef.current = annotationsRef.current.filter(a => !a.isFocused)
      setRemoveAllDisabled(annotationsRef.current.length === 0)
      setRemoveDisabled(true)
      recalculateAnnotations(true)
      redrawAnnotations()
    }

  React.useEffect(() => {
    window.addEventListener('resize', init)
    return () => window.removeEventListener('resize', init)
  }, [init])

  React.useEffect(() => {
    if (!isDefaultCanvasWidthFixed.current) return
    const focused = annotationsRef.current.find(a => a.isFocused)
    if (focused) {
      const tagChanged = focused.tag !== activeTag
      focused.tag = activeTag
      if (tagChanged) onAnnotate(annotationsRef.current)
    }
    recalculateAnnotations()
    redrawAnnotations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTag, onAnnotate, recalculateAnnotations, redrawAnnotations])

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
      <Fluent.Stack horizontal horizontalAlign='space-between' verticalAlign='center'>
        <Fluent.CommandBar styles={{ root: { padding: 0, minWidth: 280 } }} items={[
          {
            key: 'remove-all',
            text: 'Remove all',
            onClick: reset,
            disabled: removeAllDisabled,
            iconProps: { iconName: 'DependencyRemove', styles: { root: { fontSize: 20 } } },
          },
          {
            key: 'remove',
            text: 'Remove selected',
            onClick: removeAnnotation,
            disabled: removeDisabled,
            iconProps: { iconName: 'Delete', styles: { root: { fontSize: 20 } } },
          },
        ]}
        />
        {onRenderToolbar && onRenderToolbar()}
      </Fluent.Stack>
      <div className={css.annotatorContainer}>
        {children}
        <canvas
          height={WAVEFORM_HEIGHT}
          className={css.annotatorCanvas}
          ref={canvasRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
          onClick={onClick}
        />
      </div>
      <Fluent.Stack horizontal horizontalAlign='space-between' styles={{ root: { marginTop: 8 } }}>
        <div>{formatTime(0)}</div>
        <div>{formatTime(duration)}</div>
      </Fluent.Stack>
    </>
  )
}
