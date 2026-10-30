import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pausedLine, previewLine } from './preview';
import { CameraStage, SharePreview } from './Stage';

class StillResizeObserver {
  observe(): void {
    // jsdom lays nothing out: the place keeps no size.
  }
  disconnect(): void {
    // Nothing to stop.
  }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', StillResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SharePreview', () => {
  it('holds the frame and its line hidden until the picture’s size is known, so neither jumps', () => {
    const stream = {} as MediaStream;
    const { container } = render(
      <SharePreview
        stream={stream}
        line={previewLine('Kira')}
        place="pinned"
        floatRight={0}
        stageWidth={1024}
        bannerShows={false}
        pause={null}
      />,
    );
    const frame = container.querySelector<HTMLElement>('.va-preview__frame');
    const line = container.querySelector<HTMLElement>('.va-preview__line');
    const video = container.querySelector('video');
    expect(frame?.style.visibility).toBe('hidden');
    expect(line?.style.visibility).toBe('hidden');

    if (!video) throw new Error('No video.');
    Object.defineProperty(video, 'videoWidth', { value: 1280 });
    Object.defineProperty(video, 'videoHeight', { value: 720 });
    act(() => {
      video.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(frame?.style.visibility).toBe('');
    expect(line?.style.visibility).toBe('');
    // The share is shown as it is: never mirrored, unlike the camera.
    expect(video.className).toBe('va-preview__video');
  });

  it('paused, holds the last frame under a veil that is the frame’s own, with Resume and its key on a pill', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve());
    const onResume = vi.fn();
    const props = {
      stream: {} as MediaStream,
      line: pausedLine('Kira'),
      place: 'pinned' as const,
      floatRight: 0,
      stageWidth: 1024,
      bannerShows: false,
    };
    const { container, getByRole, rerender } = render(
      <SharePreview {...props} pause={{ keyLabel: 'Alt V', keyShortcuts: 'Alt+V', onResume }} />,
    );
    const video = container.querySelector('video');
    if (!video) throw new Error('No video.');
    Object.defineProperty(video, 'videoWidth', { value: 1280 });
    Object.defineProperty(video, 'videoHeight', { value: 720 });
    act(() => {
      video.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(pause).toHaveBeenCalledTimes(1);
    const veil = container.querySelector('.va-preview__frame > .va-paused--frame');
    expect(veil).not.toBeNull();

    expect(container.querySelector('.va-preview__line')?.textContent).toBe('Paused');
    const pill = container.querySelector('.va-paused__pill');
    expect(pill?.textContent).toContain('Vision paused');
    const resume = getByRole('button', { name: 'Resume vision' });
    expect(resume.textContent).toContain('Resume');
    expect(resume.textContent).toContain('Alt V');
    expect(resume.getAttribute('aria-keyshortcuts')).toBe('Alt+V');
    fireEvent.click(resume);
    expect(onResume).toHaveBeenCalledTimes(1);

    // Resumed, the picture plays again and the veil goes.
    rerender(<SharePreview {...props} line={previewLine('Kira')} pause={null} />);
    expect(container.querySelector('.va-paused')).toBeNull();
    expect(container.querySelector('.va-paused__pill')).toBeNull();
    return Promise.resolve().then(() => {
      expect(play).toHaveBeenCalledTimes(1);
      pause.mockRestore();
      play.mockRestore();
    });
  });
});

describe('CameraStage', () => {
  it('paused, veils the whole stage with the pill and drops the viewfinder, which means a live camera', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const stream = {} as MediaStream;
    const { container, rerender } = render(<CameraStage stream={stream} pause={null} />);
    expect(container.querySelectorAll('.va-camera__corner')).toHaveLength(4);
    expect(container.querySelector('.va-paused')).toBeNull();

    rerender(
      <CameraStage
        stream={stream}
        pause={{ keyLabel: '⌥ V', keyShortcuts: 'Alt+V', onResume: () => undefined }}
      />,
    );
    expect(container.querySelectorAll('.va-camera__corner')).toHaveLength(0);
    expect(
      container.querySelector('.va-camera > .va-paused--stage .va-paused__pill'),
    ).not.toBeNull();
    expect(container.querySelector('.convai-key-cap')?.textContent).toBe('⌥ V');
    expect(pause).toHaveBeenCalledTimes(1);
    pause.mockRestore();
  });
});
