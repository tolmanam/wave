// Copyright 2020 H2O.ai, Inc
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { act, fireEvent, render } from '@testing-library/react'
import React from 'react'
import { AudioAnnotator, XAudioAnnotator } from './audio_annotator'
import { wave } from './ui'

const
  name = 'audio_annotator',
  items = [
    { from: 0, to: 20, tag: 'tag1' },
    { from: 60, to: 90, tag: 'tag2' },
  ],
  model: AudioAnnotator = {
    name,
    src: '',
    tags: [
      { name: 'tag1', label: 'Tag 1', color: 'red' },
      { name: 'tag2', label: 'Tag 2', color: 'blue' },
    ],
    items
  },
  waitForLoad = async () => act(() => new Promise(res => setTimeout(() => res(), 20)))

class MockAudioContext {
  createGain = () => ({ gain: {} })
  createMediaElementSource = () => this
  connect = () => this
  decodeAudioData = () => ({ duration: 1, getChannelData: () => [1] })
}

describe('AudioAnnotator.tsx', () => {
  beforeAll(() => {
    // @ts-ignore
    window.AudioContext = MockAudioContext
    // @ts-ignore
    window.fetch = () => ({ arrayBuffer: () => '' })
    // @ts-ignore
    window.URL = { createObjectURL: () => '' }
    // @ts-ignore
    window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ width: 100, left: 0, top: 0 })
  })

  it('Renders data-test attr', async () => {
    const { queryByTestId } = render(<XAudioAnnotator model={model} />)
    await waitForLoad()
    expect(queryByTestId(name)).toBeInTheDocument()
  })

  it('Sets annotation args - empty ', async () => {
    render(<XAudioAnnotator model={{ ...model, items: undefined }} />)
    await waitForLoad()
    expect(wave.args[name]).toMatchObject([])
  })

  it('Sets annotation args ', async () => {
    render(<XAudioAnnotator model={model} />)
    await waitForLoad()
    expect(wave.args[name]).toMatchObject(items)
  })

  it('Displays correct cursor when hovering over canvas - no intersection', async () => {
    const { container } = render(<XAudioAnnotator model={model} />)
    await waitForLoad()
    const canvasEl = container.querySelector('canvas')!
    fireEvent.mouseMove(canvasEl, { clientX: 25, clientY: 25 })
    expect(canvasEl.style.cursor).toBe('pointer')
  })

  it('Removes all shapes after clicking reset', async () => {
    const { getByTitle } = render(<XAudioAnnotator model={model} />)
    await waitForLoad()
    expect(wave.args[name]).toMatchObject(items)
    fireEvent.click(getByTitle('reset audio annotator'))
    expect(wave.args[name]).toMatchObject([])
  })

  describe('Annotations', () => {
    it('Draws a new annotation', async () => {
      const { container } = render(<XAudioAnnotator model={model} />)
      await waitForLoad()
      const canvasEl = container.querySelector('canvas')!
      fireEvent.mouseDown(canvasEl, { clientX: 30, clientY: 10, buttons: 1 })
      fireEvent.mouseMove(canvasEl, { clientX: 40, clientY: 20, buttons: 1 })
      fireEvent.click(canvasEl, { clientX: 40, clientY: 20, buttons: 1 })

      expect(wave.args[name]).toHaveLength(3)
      expect(wave.args[name]).toMatchObject([items[0], { tag: 'tag1', from: 30, to: 40 }, items[1]])
    })

    it('Does not draw a new annotation if left mouse click not pressed', async () => {
      const { container } = render(<XAudioAnnotator model={model} />)
      await waitForLoad()
      const canvasEl = container.querySelector('canvas')!
      fireEvent.mouseDown(canvasEl, { clientX: 10, clientY: 10 })
      fireEvent.mouseMove(canvasEl, { clientX: 20, clientY: 20 })
      fireEvent.click(canvasEl, { clientX: 20, clientY: 20 })

      expect(wave.args[name]).toHaveLength(2)
      expect(wave.args[name]).toMatchObject(items)
    })

    it('Draws a new annotation with different tag if selected', async () => {
      const { container, getByText } = render(<XAudioAnnotator model={model} />)
      await waitForLoad()
      fireEvent.click(getByText('Tag 2'))
      const canvasEl = container.querySelector('canvas')!
      fireEvent.mouseDown(canvasEl, { clientX: 30, clientY: 10, buttons: 1 })
      fireEvent.mouseMove(canvasEl, { clientX: 40, clientY: 20, buttons: 1 })
      fireEvent.click(canvasEl, { clientX: 40, clientY: 20, buttons: 1 })

      expect(wave.args[name]).toHaveLength(3)
      expect(wave.args[name]).toMatchObject([items[0], { tag: 'tag2', from: 30, to: 40 }, items[1]])
    })

    it('Removes annotation after clicking remove btn', async () => {
      const { container, getByTitle } = render(<XAudioAnnotator model={model} />)
      await waitForLoad()
      const canvasEl = container.querySelector('canvas')!
      expect(wave.args[name]).toMatchObject(items)

      const removeBtn = getByTitle('remove audio annotation')!
      expect(removeBtn).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(canvasEl, { clientX: 3, clientY: 3 })
      expect(removeBtn).not.toHaveAttribute('aria-disabled')
      fireEvent.click(removeBtn)

      expect(wave.args[name]).toHaveLength(1)
      expect(wave.args[name]).toMatchObject([items[1]])
    })

    it('Changes tag when clicked existing annotation', async () => {
      const { container, getByText } = render(<XAudioAnnotator model={model} />)
      await waitForLoad()
      const canvasEl = container.querySelector('canvas')!
      fireEvent.click(canvasEl, { clientX: 3, clientY: 3 })
      fireEvent.click(getByText('Tag 2'))

      expect(wave.args[name]).toMatchObject([{ ...items[0], tag: 'tag2' }, items[1]])
    })

    it('Displays the annotation cursor when hovering over annotation', async () => {
      const { container } = render(<XAudioAnnotator model={model} />)
      await waitForLoad()
      const canvasEl = container.querySelector('canvas')!
      fireEvent.mouseMove(canvasEl, { clientX: 3, clientY: 3 })
      expect(canvasEl.style.cursor).toBe('pointer')
      fireEvent.mouseMove(canvasEl, { clientX: 15, clientY: 3 })
      expect(canvasEl.style.cursor).toBe('pointer')
      fireEvent.mouseMove(canvasEl, { clientX: 20, clientY: 3 })
      fireEvent.click(canvasEl, { clientX: 20, clientY: 3 })
      fireEvent.mouseMove(canvasEl, { clientX: 12, clientY: 3 })
      expect(canvasEl.style.cursor).toBe('pointer')
    })

    it('Displays move cursor when dragging the focused annotation', async () => {
      const { container } = render(<XAudioAnnotator model={model} />)
      await waitForLoad()
      const canvasEl = container.querySelector('canvas')!
      fireEvent.mouseMove(canvasEl, { clientX: 3, clientY: 3 })
      fireEvent.click(canvasEl, { clientX: 3, clientY: 3 })
      expect(canvasEl.style.cursor).toBe('pointer')
      fireEvent.mouseDown(canvasEl, { clientX: 3, clientY: 3, buttons: 1 })
      fireEvent.mouseMove(canvasEl, { clientX: 4, clientY: 4, buttons: 1 })
      expect(canvasEl.style.cursor).toBe('move')
      fireEvent.mouseMove(canvasEl, { clientX: 30, clientY: 5 })
      fireEvent.click(canvasEl, { clientX: 30, clientY: 5 })
      expect(canvasEl.style.cursor).toBe('pointer')
    })

    it.only('Displays resize cursor when dragging the focused annotation', async () => {
      const { container } = render(<XAudioAnnotator model={model} />)
      await waitForLoad()
      const canvasEl = container.querySelector('canvas')!
      fireEvent.mouseMove(canvasEl, { clientX: 20, clientY: 3 })
      expect(canvasEl.style.cursor).toBe('pointer')
      fireEvent.click(canvasEl, { clientX: 20, clientY: 3 })
      expect(canvasEl.style.cursor).toBe('ew-resize')
      fireEvent.mouseDown(canvasEl, { clientX: 20, clientY: 3, buttons: 1 })
      fireEvent.mouseMove(canvasEl, { clientX: 30, clientY: 4, buttons: 1 })
      expect(canvasEl.style.cursor).toBe('ew-resize')
      fireEvent.mouseMove(canvasEl, { clientX: 40, clientY: 5 })
      expect(canvasEl.style.cursor).toBe('pointer')
      fireEvent.click(canvasEl, { clientX: 40, clientY: 5 })
      expect(canvasEl.style.cursor).toBe('pointer')
    })

    it('Moves annotation', () => {
      const { container } = render(<XAudioAnnotator model={model} />)
      const canvasEl = container.querySelector('canvas')!
      fireEvent.click(canvasEl, { clientX: 50, clientY: 50 })
      fireEvent.mouseDown(canvasEl, { clientX: 50, clientY: 50 })
      fireEvent.mouseMove(canvasEl, { clientX: 60, clientY: 60, buttons: 1 })
      fireEvent.click(canvasEl, { clientX: 60, clientY: 60 })

      expect(wave.args[name]).toMatchObject([{ tag: 'person', shape: { annotation: { x1: 20, x2: 110, y1: 20, y2: 110 } } }, polygon])
    })

    it('Does not move annotation if left mouse btn not pressed (dragging)', () => {
      const { container } = render(<XAudioAnnotator model={model} />)
      const canvasEl = container.querySelector('canvas')!
      fireEvent.click(canvasEl, { clientX: 50, clientY: 50 })
      fireEvent.mouseDown(canvasEl, { clientX: 50, clientY: 50 })
      fireEvent.mouseMove(canvasEl, { clientX: 60, clientY: 60 })
      fireEvent.click(canvasEl, { clientX: 60, clientY: 60 })

      expect(wave.args[name]).toMatchObject(items)
    })

    it('Resizes top left corner properly', () => {
      const { container } = render(<XAudioAnnotator model={model} />)
      const canvasEl = container.querySelector('canvas')!
      fireEvent.click(canvasEl, { clientX: 50, clientY: 50 })
      fireEvent.mouseDown(canvasEl, { clientX: 10, clientY: 10 })
      fireEvent.mouseMove(canvasEl, { clientX: 5, clientY: 5, buttons: 1 })
      fireEvent.click(canvasEl, { clientX: 5, clientY: 5 })

      expect(wave.args[name]).toMatchObject([
        { tag: 'person', shape: { annotation: { x1: 5, x2: 100, y1: 5, y2: 100 } } },
        polygon
      ])
    })

    it('Resizes top right corner properly', () => {
      const { container } = render(<XAudioAnnotator model={model} />)
      const canvasEl = container.querySelector('canvas')!
      fireEvent.click(canvasEl, { clientX: 50, clientY: 50 })
      fireEvent.mouseDown(canvasEl, { clientX: 100, clientY: 10 })
      fireEvent.mouseMove(canvasEl, { clientX: 105, clientY: 5, buttons: 1 })
      fireEvent.click(canvasEl, { clientX: 5, clientY: 5 })

      expect(wave.args[name]).toMatchObject([
        { tag: 'person', shape: { annotation: { x1: 10, x2: 105, y1: 5, y2: 100 } } },
        polygon
      ])
    })

  })
})