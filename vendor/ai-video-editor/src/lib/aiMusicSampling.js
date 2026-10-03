export function buildPingPongSchedule(steps, sigmaMax = 1) {
  const count = Math.max(1, Math.floor(steps));
  return Array.from({ length: count + 1 }, (_, index) => {
    if (index === 0) return sigmaMax;
    if (index === count) return 0;
    const t = sigmaMax * (1 - index / count);
    const logSnr = 2 - t * 8.2;
    return 1 / (1 + Math.exp(logSnr));
  });
}

export function pingPongStep(latent, velocity, current, next, noise) {
  const updated = new Float32Array(latent.length);
  const isFinalStep = next <= 0;
  for (let index = 0; index < latent.length; index += 1) {
    const denoised = latent[index] - current * velocity[index];
    updated[index] = isFinalStep
      ? denoised
      : (1 - next) * denoised + next * noise[index];
  }
  return updated;
}
