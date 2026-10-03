import { describe, expect, it } from 'vitest';

import serviceWorkerSource from '../../../vendor/ai-video-editor/public/model-cache-sw.js?raw';

describe('upstream model cache host routing', () => {
  it('recognizes provider-managed ModelScope CDN subdomains without trusting lookalike domains', () => {
    expect(serviceWorkerSource).toContain('hostname.endsWith(".modelscope.cn")');
    expect(serviceWorkerSource).toContain('isModelScopeHost(url.hostname)');
    expect(serviceWorkerSource).not.toContain('hostname.includes("modelscope.cn")');
  });
});
