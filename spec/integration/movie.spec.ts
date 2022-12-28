import etro from '../../src/index'

function validateVideoData (video: HTMLVideoElement) {
  // Now the video is loaded. Create temporary canvas and render first
  // frame onto it.
  const ctx = document
    .createElement('canvas')
    .getContext('2d')
  ctx.canvas.width = video.videoWidth
  ctx.canvas.height = video.videoHeight
  ctx.drawImage(video, 0, 0)
  // Expect all opaque blue pixels
  // Make array of v.videoWidth * v.videoHeight red pixels
  const expectedImageData = new Uint8ClampedArray(video.videoWidth * video.videoHeight * 4)
  for (let i = 0; i < expectedImageData.length; i += 4) {
    expectedImageData[i] = 0
    expectedImageData[i + 1] = 0
    expectedImageData[i + 2] = 255
    expectedImageData[i + 3] = 255
  }
  const actualImageData = Array.from(
    ctx.getImageData(0, 0, video.videoWidth, video.videoHeight).data
  )
  const maxDiff = actualImageData
    // Calculate diff image data
    .map((x, i) => x - expectedImageData[i])
    // Find max pixel component diff
    .reduce((x, max) => Math.max(x, max))

  // Now, there is going to be variance due to encoding problems.
  // Accept an error of 5 for each color component (5 is somewhat
  // arbitrary, but it works).
  expect(maxDiff).toBeLessThanOrEqual(5)
}

describe('Integration Tests ->', function () {
  describe('Movie', function () {
    let movie, canvas

    beforeEach(function () {
      if (canvas)
        document.body.removeChild(canvas)

      canvas = document.createElement('canvas')
      // Resolutions lower than 20x20 result in empty blobs.
      canvas.width = 20
      canvas.height = 20
      document.body.appendChild(canvas)

      movie = new etro.Movie({ canvas, background: new etro.Color(0, 0, 255) })
      movie.addLayer(new etro.layer.Visual({ startTime: 0, duration: 0.8 }))
    })

    describe('playback ->', function () {
      it('should play with an audio layer without errors', async function () {
        // Remove all existing layers (optional)
        movie.layers.length = 0

        // Add an audio layer
        // movie.layers.push(new etro.layer.Oscillator({ startTime: 0, duration: 1 }));
        const audio = new Audio('/base/spec/integration/assets/layer/audio.wav')
        await new Promise(resolve => {
          audio.onloadeddata = resolve
        })
        const layer = new etro.layer.Audio({
          source: audio,
          startTime: 0,
          playbackRate: 1,
          duration: audio.duration
        })
        movie.layers.push(layer)

        // Record
        await movie.play()
      })

      it('should never decrease its currentTime during one playthrough', async function () {
        let prevTime
        etro.event.subscribe(movie, 'timeupdate', () => {
          if (prevTime !== undefined && !movie.paused)
            expect(movie.currentTime).toBeGreaterThan(prevTime)

          prevTime = movie.currentTime
        })

        await movie.play()
      })

      it('should never decrease its currentTime while recording', async function () {
        let prevTime
        etro.event.subscribe(movie, 'timeupdate', () => {
          if (prevTime !== undefined && !movie.ended)
            expect(movie.currentTime).toBeGreaterThan(prevTime)

          prevTime = movie.currentTime
        })

        await movie.record({ frameRate: 10 })
      })

      it('should return blob after recording', async function () {
        const video = await movie.record({ frameRate: 60 })
        expect(video.size).toBeGreaterThan(0)
      })

      it('should return nonempty blob when recording with one audio layer', async function () {
        // Remove all existing layers (optional)
        movie.layers.length = 0

        // Add an audio layer
        // movie.layers.push(new etro.layer.Oscillator({ startTime: 0, duration: 1 }));
        const audio = new Audio('/base/spec/integration/assets/layer/audio.wav')
        await new Promise(resolve => {
          audio.onloadeddata = resolve
        })
        const layer = new etro.layer.Audio({
          source: audio,
          startTime: 0,
          playbackRate: 1,
          duration: audio.duration
        })
        movie.layers.push(layer)

        // Record
        const video = await movie.record({ frameRate: 30 })
        expect(video.size).toBeGreaterThan(0)
      })

      it('can record with custom MIME type', async function () {
        const video = await movie.record({ frameRate: 60, type: 'video/webm;codecs=vp8' })
        expect(video.type).toBe('video/webm;codecs=vp8')
      })

      it('should return a stream with a video track when streaming with default options and without an audio layer', function (done) {
        let stream: MediaStream

        movie.stream({
          frameRate: 10
        }).then(() => {
          expect(stream.getVideoTracks().length).toBe(1)
          expect(stream.getAudioTracks().length).toBe(0)
          done()
        })

        movie.getStream().then((s: MediaStream) => {
          stream = s
        })
      })

      it('should return a stream with a video track when streaming with audio: false', function (done) {
        let stream: MediaStream

        movie.stream({
          frameRate: 10,
          audio: false
        }).then(() => {
          expect(stream.getVideoTracks().length).toBe(1)
          expect(stream.getAudioTracks().length).toBe(0)
          done()
        })

        movie.getStream().then((s: MediaStream) => {
          stream = s
        })
      })

      it('should produce correct image data when streaming', function (done) {
        // Stream movie
        movie.stream({ frameRate: 10 }).then(() => {
          done()
        })

        // Get the stream and create a video element from it
        movie.getStream().then((stream: MediaStream) => {
          // Load stream into html video element
          const video = document.createElement('video')
          video.srcObject = stream

          // Wait for the current frame to load
          return new Promise<HTMLVideoElement>(resolve => {
            video.onloadeddata = () => {
              resolve(video)
            }
          })
        }).then((video: HTMLVideoElement) => (
          // Render the first frame of the video to a canvas and make sure the
          // image data is correct.
          validateVideoData(video)
        ))
      })

      it('should produce correct image data when recording', async function () {
        // Record movie
        const blob = await movie.record({ frameRate: 10 })

        // Load blob into html video element
        const video = document.createElement('video')
        video.src = URL.createObjectURL(blob)
        // Since it's a blob, we need to force-load all frames for it to
        // render properly, using this hack:
        video.currentTime = Number.MAX_SAFE_INTEGER
        await new Promise<void>(resolve => {
          video.ontimeupdate = () => {
            resolve()
          }
        })

        // Render the first frame of the video to a canvas and make sure the
        // image data is correct.
        validateVideoData(video)

        // Clean up
        URL.revokeObjectURL(video.src)
      })
    })

    describe('events ->', function () {
      class CustomLayer extends etro.layer.Base {
        private _ready = false

        makeReady () {
          this._ready = true
          etro.event.publish(this, 'ready', {})
        }

        get ready () {
          return this._ready
        }
      }

      class CustomEffect extends etro.effect.Base {
        private _ready = false

        makeReady () {
          this._ready = true
          etro.event.publish(this, 'ready', {})
        }

        get ready () {
          return this._ready
        }
      }

      it("should fire 'play' once when starting to play", async function () {
        let timesFired = 0
        etro.event.subscribe(movie, 'play', function () {
          timesFired++
        })
        await movie.play()
        expect(timesFired).toBe(1)
      })

      it("should fire 'pause' once", function (done) {
        let timesFired = 0
        etro.event.subscribe(movie, 'pause', function () {
          timesFired++
        })
        // play, pause and check if event was fired
        movie.play().then(() => {
          done()
        })
        movie.pause()
        expect(timesFired).toBe(1)
      })

      it("should fire 'play' once when streaming starts", async function () {
        let timesFired = 0
        etro.event.subscribe(movie, 'play', function () {
          timesFired++
        })
        await movie.stream({
          frameRate: 1
        })
        expect(timesFired).toBe(1)
      })

      it("should fire 'play' once when recording", async function () {
        let timesFired = 0
        etro.event.subscribe(movie, 'play', function () {
          timesFired++
        })
        await movie.record({ frameRate: 1 })
        expect(timesFired).toBe(1)
      })

      it("should fire 'ended' when done playing", async function () {
        let timesFired = 0
        etro.event.subscribe(movie, 'ended', function () {
          timesFired++
        })
        await movie.play()
        expect(timesFired).toBe(1)
      })

      it("should fire 'loadeddata'", async function () {
        /*
         * 'loadeddata' gets timesFired when the frame is fully loaded
         */

        let firedOnce = false
        etro.event.subscribe(movie, 'loadeddata', () => {
          firedOnce = true
        })
        await movie.refresh()
        expect(firedOnce).toBe(true)
      })

      it("should fire 'seek'", function () {
        let timesFired = 0
        etro.event.subscribe(movie, 'seek', function () {
          timesFired++
        })
        movie.currentTime = movie.duration / 2
        expect(timesFired).toBe(1)
      })

      it("should fire 'timeupdate'", async function () {
        let firedOnce = false
        etro.event.subscribe(movie, 'timeupdate', function () {
          firedOnce = true
        })
        await movie.play()
        expect(firedOnce).toBe(true)
      })

      it("should publish 'ready' when its layers and effects become ready", function (done) {
        // Remove all layers and effects
        movie.layers.length = 0
        movie.effects.length = 0

        // Add a layer that is not ready
        const layer = new CustomLayer({
          startTime: 0,
          duration: 1
        })
        movie.layers.push(layer)

        // Add an effect that is not ready
        const effect = new CustomEffect()
        movie.effects.push(effect)

        // Subscribe to the event
        etro.event.subscribe(movie, 'ready', () => {
          done()
        })

        // Make the layer and effect ready
        layer.makeReady()
        effect.makeReady()
      })
    })
  })
})
