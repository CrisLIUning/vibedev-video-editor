/**
 * The question asked before the editor downloads an AI model: what it is for,
 * how big it is, its licence and where it comes from. Shown over the editor
 * in the page's own colours; Esc or 不下载 declines, and nothing downloads.
 */

import type { ModelListing } from './api.ts';
import type { AskConsent, ConsentAnswer } from './models.ts';

/** What each capability uses its model for, finishing "才能…". */
const PURPOSES: Readonly<Record<string, string>> = {
  tts: '生成配音',
  music: '把人声和伴奏分开',
  transcribe: '识别语音',
  avatar: '让照片里的人物开口说话',
  repair: '擦掉画面里不要的东西',
  restoration: '提升画面清晰度',
  depth: '估算画面景深',
  segmentation: '抠出人物或物体',
  'caption-font': '用这款字体显示字幕',
};

/** A size for people: KB below a megabyte, GB from a gigabyte. */
export function formatBytes(bytes: number): string {
  const megabyte = 1024 * 1024;
  if (bytes < megabyte) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * megabyte) return `${(bytes / megabyte).toFixed(1)} MB`;
  return `${(bytes / (1024 * megabyte)).toFixed(2)} GB`;
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, attributes: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Build the question for a model (exported for tests).
 * @param doc - the page's document.
 * @param model - the model asked about.
 * @returns the dialog and its controls.
 */
export function consentDialog(doc: Document, model: ModelListing): { root: HTMLElement; confirm: HTMLButtonElement; decline: HTMLButtonElement; group: HTMLInputElement | null } {
  const root = element(doc, 'div', { class: 'consent', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'consent-title', 'aria-describedby': 'consent-lead' });
  const card = element(doc, 'div', { class: 'consent-card' });
  root.append(card);
  card.append(element(doc, 'h2', { id: 'consent-title' }, '下载 AI 模型'));
  const purpose = PURPOSES[model.capability] ?? '使用这项功能';
  card.append(element(doc, 'p', { id: 'consent-lead', class: 'consent-lead' }, `剪辑台要先下载「${model.label}」，才能${purpose}。`));

  const facts = element(doc, 'dl', { class: 'consent-facts' });
  const fact = (term: string, ...content: (Node | string)[]): void => {
    const description = element(doc, 'dd');
    description.append(...content);
    facts.append(element(doc, 'dt', {}, term), description);
  };
  fact('大小', `${formatBytes(model.totalBytes)}，只下载一次，存在这台电脑上`);
  const license: (Node | string)[] = [];
  if (model.license.url !== undefined && /^https:\/\//.test(model.license.url)) {
    license.push(element(doc, 'a', { href: model.license.url, target: '_blank', rel: 'noopener noreferrer' }, model.license.name));
  } else {
    license.push(model.license.name);
  }
  if (model.license.notice !== undefined && model.license.notice.trim() !== '') {
    license.push(element(doc, 'span', { class: 'consent-note' }, model.license.notice));
  }
  fact('许可', ...license);
  fact('来源', model.sourceHosts.join('、'));
  card.append(facts);

  let group: HTMLInputElement | null = null;
  if (model.group !== undefined && (model.groupSize ?? 0) > 1) {
    const label = element(doc, 'label', { class: 'consent-group' });
    group = element(doc, 'input', { type: 'checkbox' });
    group.checked = true;
    label.append(group, `其余 ${(model.groupSize ?? 1) - 1} 款字幕字体（同为 ${model.license.name}）以后直接下载，不再询问`);
    card.append(label);
  }

  const actions = element(doc, 'div', { class: 'consent-actions' });
  const decline = element(doc, 'button', { type: 'button', 'data-action': 'decline' }, '不下载');
  const confirm = element(doc, 'button', { type: 'button', 'data-action': 'confirm', class: 'primary' }, '下载');
  actions.append(decline, confirm);
  card.append(actions);
  return { root, confirm, decline, group };
}

/**
 * The page's way of asking: one dialog at a time over the editor.
 * @param doc - the page's document.
 */
export function createConsentPrompt(doc: Document = document): AskConsent {
  return model => new Promise<ConsentAnswer>((resolve) => {
    const { root, confirm, decline, group } = consentDialog(doc, model);
    const previous = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    const close = (granted: boolean): void => {
      doc.removeEventListener('keydown', onKey, true);
      root.remove();
      previous?.focus?.();
      resolve({ granted, group: granted && group?.checked === true });
    };
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(false);
      }
    }
    confirm.addEventListener('click', () => { close(true); });
    decline.addEventListener('click', () => { close(false); });
    doc.addEventListener('keydown', onKey, true);
    doc.body.append(root);
    confirm.focus();
  });
}
