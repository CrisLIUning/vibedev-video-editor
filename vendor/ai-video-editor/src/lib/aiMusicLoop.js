function copyAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

export function repeatPcm16WavWithFades(sourceBuffer, repeats = 2, fadeSeconds = 1.5) {
  return repeatWavSection(sourceBuffer, getWavInfo(sourceBuffer).sourceFrames, repeats, fadeSeconds);
}

export function repeatPcm16WavAtBestBoundary(sourceBuffer, repeats = 2, searchSeconds = 5) {
  const info = getWavInfo(sourceBuffer);
  const boundary = findBestLoopBoundary(sourceBuffer, searchSeconds);
  return repeatWavSection(sourceBuffer, boundary.cutFrame, repeats, boundary.fadeSeconds, info);
}

export function findBestLoopBoundary(sourceBuffer, searchSeconds = 5) {
  const info = getWavInfo(sourceBuffer);
  const { source, channels, sampleRate, sourceFrames } = info;
  const searchFrames = Math.min(sourceFrames >> 1, Math.round(searchSeconds * sampleRate));
  const firstCut = Math.max(1, sourceFrames - searchFrames);
  const lastCut = Math.max(firstCut, sourceFrames - Math.round(sampleRate * 0.08));
  const hop = Math.max(1, Math.round(sampleRate / 200));
  const window = Math.max(2, Math.round(sampleRate * 0.06));
  const sampleMono = (frame) => {
    let sum = 0;
    const safeFrame = Math.max(0, Math.min(sourceFrames - 1, frame));
    for (let channel = 0; channel < channels; channel += 1) {
      sum += source.getInt16(44 + (safeFrame * channels + channel) * 2, true) / 32768;
    }
    return sum / channels;
  };

  const head = sampleMono(0);
  const headSlope = sampleMono(1) - head;
  let best = { cutFrame: lastCut, score: Number.POSITIVE_INFINITY, rms: 0 };
  for (let cutFrame = firstCut; cutFrame <= lastCut; cutFrame += hop) {
    let energy = 0;
    const samples = 16;
    for (let index = 0; index < samples; index += 1) {
      const frame = cutFrame - 1 - Math.round(index * window / samples);
      const value = sampleMono(frame);
      energy += value * value;
    }
    const rms = Math.sqrt(energy / samples);
    const tail = sampleMono(cutFrame - 1);
    const tailSlope = tail - sampleMono(cutFrame - 2);
    const jump = Math.abs(tail - head);
    const slopeJump = Math.abs(tailSlope - headSlope);
    const shortenedRatio = (sourceFrames - cutFrame) / Math.max(1, searchFrames);
    const score = rms * 0.7 + jump * 0.8 + slopeJump * 0.25 + shortenedRatio * 0.08;
    if (score < best.score) best = { cutFrame, score, rms };
  }

  const fadeSeconds = Math.max(0.25, Math.min(1.5, 0.25 + best.rms * 4));
  return { ...best, fadeSeconds };
}

function getWavInfo(sourceBuffer) {
  const source = new DataView(sourceBuffer);
  if (
    copyFourCC(source, 0) !== "RIFF"
    || copyFourCC(source, 8) !== "WAVE"
    || copyFourCC(source, 36) !== "data"
    || source.getUint16(20, true) !== 1
    || source.getUint16(34, true) !== 16
  ) {
    throw new Error("AI music looping requires a PCM 16-bit WAV.");
  }

  const channels = source.getUint16(22, true);
  const sampleRate = source.getUint32(24, true);
  const sourceDataBytes = source.getUint32(40, true);
  const frameBytes = channels * 2;
  const sourceFrames = Math.floor(sourceDataBytes / frameBytes);
  return { source, channels, sampleRate, frameBytes, sourceFrames };
}

function repeatWavSection(sourceBuffer, sectionFrames, repeats, fadeSeconds, wavInfo = getWavInfo(sourceBuffer)) {
  const { source, channels, sampleRate, frameBytes, sourceFrames } = wavInfo;
  const usedFrames = Math.max(1, Math.min(sourceFrames, Math.floor(sectionFrames)));
  const repeatCount = Math.max(1, Math.floor(repeats));
  const outputDataBytes = usedFrames * frameBytes * repeatCount;
  const outputBuffer = new ArrayBuffer(44 + outputDataBytes);
  const output = new DataView(outputBuffer);

  new Uint8Array(outputBuffer, 0, 44).set(new Uint8Array(sourceBuffer, 0, 44));
  copyAscii(output, 0, "RIFF");
  output.setUint32(4, 36 + outputDataBytes, true);
  output.setUint32(40, outputDataBytes, true);

  const fadeFrames = Math.min(usedFrames >> 1, Math.max(1, Math.round(fadeSeconds * sampleRate)));
  for (let repeat = 0; repeat < repeatCount; repeat += 1) {
    for (let frame = 0; frame < usedFrames; frame += 1) {
      let gain = 1;
      if (repeat > 0 && frame < fadeFrames) {
        gain *= Math.sin((frame / fadeFrames) * Math.PI / 2);
      }
      if (repeat < repeatCount - 1 && frame >= usedFrames - fadeFrames) {
        gain *= Math.cos(((frame - (usedFrames - fadeFrames)) / fadeFrames) * Math.PI / 2);
      }
      for (let channel = 0; channel < channels; channel += 1) {
        const sourceOffset = 44 + (frame * channels + channel) * 2;
        const outputFrame = repeat * usedFrames + frame;
        const outputOffset = 44 + (outputFrame * channels + channel) * 2;
        output.setInt16(outputOffset, Math.round(source.getInt16(sourceOffset, true) * gain), true);
      }
    }
  }
  return outputBuffer;
}

function copyFourCC(view, offset) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}
