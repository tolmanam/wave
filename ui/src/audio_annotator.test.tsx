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

import { act, fireEvent, render, waitFor } from '@testing-library/react'
import React from 'react'
import { AudioAnnotator, XAudioAnnotator } from './audio_annotator'
import { wave } from './ui'

const
  name = 'audio_annotator',
  items = [
    { from: 0, to: 5, tag: 'tag1' },
    { from: 6, to: 9, tag: 'tag2' },
  ],
  model: AudioAnnotator = {
    name,
    src: '',
    tags: [],
    items
  },
  waitForLoad = async () => act(() => new Promise(res => setTimeout(() => res(), 20)))
// volumeMock = jest.fn()

class MockAudioContext {
  createGain = () => ({ gain: {} })
  createMediaElementSource = () => this
  connect = () => this
  decodeAudioData = () => ({ getChannelData: () => [1] })
}

describe('AudioAnnotator.tsx', () => {
  beforeAll(() => {
    // @ts-ignore
    window.AudioContext = MockAudioContext
    // @ts-ignore
    window.fetch = () => ({ arrayBuffer: () => '' })
    // @ts-ignore
    window.URL = { createObjectURL: () => '' }
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

  it.only('Displays correct cursor when hovering over canvas - no intersection', async () => {
    const { container } = render(<XAudioAnnotator model={model} />)
    await waitForLoad()
    const canvasEl = container.querySelector('canvas')!
    fireEvent.mouseMove(canvasEl, { clientX: 250, clientY: 250 })
    expect(canvasEl.style.cursor).toBe('pointer')
  })

  it.skip('Removes all shapes after clicking reset', () => {
    const { getByText } = render(<XAudioAnnotator model={model} />)
    expect(wave.args[name]).toMatchObject(items)
    fireEvent.click(getByText('Reset'))
    expect(wave.args[name]).toMatchObject([])
  })

  describe('Annotations', () => {
    it('Draws a new annotation', async () => {
      const { container } = render(<XAudioAnnotator model={model} />)
      const canvasEl = container.querySelector('canvas')!
      fireEvent.mouseDown(canvasEl, { clientX: 110, clientY: 110 })
      fireEvent.click(canvasEl, { clientX: 150, clientY: 150 })

      expect(wave.args[name]).toMatchObject([{ tag: 'person', shape: { annotation: { x1: 110, x2: 150, y1: 110, y2: 150 } } }, ...items])
    })

    it('Draws a new annotation with different tag if selected', () => {
      const { container, getByText } = render(<XAudioAnnotator model={model} />)
      const canvasEl = container.querySelector('canvas')!
      fireEvent.click(getByText('annotationangle'))
      fireEvent.click(getByText('Object'))
      fireEvent.mouseDown(canvasEl, { clientX: 110, clientY: 110 })
      fireEvent.click(canvasEl, { clientX: 150, clientY: 150 })

      expect(wave.args[name]).toMatchObject([{ tag: 'object', shape: { annotation: { x1: 110, x2: 150, y1: 110, y2: 150 } } }, ...items])
    })

    it('Removes annotation after clicking remove btn', () => {
      const { container, getByText } = render(<XAudioAnnotator model={model} />)
      const canvasEl = container.querySelector('canvas')!
      expect(wave.args[name]).toMatchObject(items)

      const removeBtn = getByText('Remove selection').parentElement?.parentElement?.parentElement
      expect(removeBtn).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(canvasEl, { clientX: 50, clientY: 50 })
      expect(removeBtn).not.toHaveAttribute('aria-disabled')
      fireEvent.click(removeBtn!)

      expect(wave.args[name]).toMatchObject([])
    })

    it('Changes tag when clicked existing annotation', () => {
      const { container, getByText } = render(<XAudioAnnotator model={model} />)
      const canvasEl = container.querySelector('canvas')!
      fireEvent.click(canvasEl, { clientX: 50, clientY: 50 })
      fireEvent.click(getByText('Object'))

      expect(wave.args[name]).toMatchObject([{ ...annotation, tag: 'object' }, polygon])
    })

    it('Displays the annotation cursor when hovering over annotation', () => {
      const { container } = render(<XAudioAnnotator model={model} />)
      const canvasEl = container.querySelector('canvas')!
      fireEvent.mouseMove(canvasEl, { clientX: 50, clientY: 50 })
      expect(canvasEl.style.cursor).toBe('pointer')
    })

    it('Displays the annotation cursor when hovering over focused annotation', () => {
      const { container } = render(<XAudioAnnotator model={model} />)
      const canvasEl = container.querySelector('canvas')!
      fireEvent.click(canvasEl, { clientX: 50, clientY: 50 })
      expect(canvasEl.style.cursor).toBe('move')
      fireEvent.mouseMove(canvasEl, { clientX: 100, clientY: 100 })
      expect(canvasEl.style.cursor).toBe('nwse-resize')
      fireEvent.mouseMove(canvasEl, { clientX: 250, clientY: 250 })
      expect(canvasEl.style.cursor).toBe('auto')
    })

    it('Displays the annotation cursor when hovering over focused annotation corners', () => {
      const { container } = render(<XAudioAnnotator model={model} />)
      const canvasEl = container.querySelector('canvas')!
      fireEvent.click(canvasEl, { clientX: 50, clientY: 50 })

      // Top left.
      fireEvent.mouseMove(canvasEl, { clientX: 10, clientY: 10 })
      expect(canvasEl.style.cursor).toBe('nwse-resize')
      // Top right.
      fireEvent.mouseMove(canvasEl, { clientX: 100, clientY: 10 })
      expect(canvasEl.style.cursor).toBe('nesw-resize')
      // Bottom left.
      fireEvent.mouseMove(canvasEl, { clientX: 10, clientY: 100 })
      expect(canvasEl.style.cursor).toBe('nesw-resize')
      // Bottom right.
      fireEvent.mouseMove(canvasEl, { clientX: 100, clientY: 100 })
      expect(canvasEl.style.cursor).toBe('nwse-resize')
    })

    it('Moves annotation ', () => {
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