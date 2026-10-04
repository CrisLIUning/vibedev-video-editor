/**
 * A refusal from the plugin, said in Chinese (Studio's `timeline-refusals.ts`
 * with its zh strings, and the caption codes beside the render ones).
 *
 * The plugin answers `{ error, code }` with an English message, and the code
 * is the stable part: a code known here gets its own wording, keeping the
 * specifics — clip names, feature names, ffmpeg's last lines — from the
 * message, because those tell the person which clip or which effect. A code
 * not known here passes the plugin's message through unchanged, which is
 * still a reason and not a status.
 */

/** Wording by code; `{detail}` is what follows the message's first `: `. */
const REFUSALS: Readonly<Record<string, string>> = {
  // Rendering (Studio's codes, plus the plugin's own).
  EMPTY_TIMELINE: '时间线上还没有画面，先放一段素材再渲染',
  MISSING_MEDIA: '这些片段的文件不在项目里，渲不了：{detail}',
  UNSUPPORTED_RENDER_FEATURE: '本机渲染还不支持：{detail}',
  MISSING_RENDER_RESOURCE: '字幕用的字体还没下载：在剪辑台里选一次这个字体让它缓存，再渲染',
  INVALID_PROJECT: '剪辑档里有渲染器不接受的设置：{detail}',
  INVALID_RENDER_SETTINGS: '渲染设置不对：{detail}',
  CANVAS_TIMELINE_RENDER_INVALID: '渲染设置不对：{detail}',
  RENDER_PLAN_FAILED: '渲染没能开始：{detail}',
  CANVAS_TIMELINE_RENDER_FAILED: '渲染没能完成：{detail}',
  FFMPEG_UNAVAILABLE: '本机没有找到 ffmpeg：在 dsh-film 的设置里填 ffmpegPath 指向一个，或装好后再试',
  FFMPEG_STALLED: 'ffmpeg 一直没有出帧，已停止，多半是某个源文件坏了：{detail}',
  FFMPEG_TIMEOUT: '渲染超过时限，已停止：{detail}',
  FFMPEG_FAILED: 'ffmpeg 报错退出：{detail}',
  RENDER_CANCELED: '渲染已取消',
  RENDER_BUSY: '已经有一次渲染在进行，等它结束再渲染',
  RENDER_INTERRUPTED: '渲染过程中宿主重启，请重新渲染',
  PROJECT_NOT_FOUND: '这个影视项目找不到了',
  ASSET_VERSION_FILE_INVALID: '要放的文件不在项目里：{detail}',
  // Media tasks.
  MEDIA_TASK_CANCELED: '已取消',
  MEDIA_TASK_INTERRUPTED: '宿主重启，任务中断了，请重新开始',
  // The cut itself.
  CANVAS_TIMELINE_CONFLICT: '剪辑刚被别处改过，已载入最新的剪辑；确认后再试',
  CANVAS_TIMELINE_CONFLICT_UNREADABLE: '剪辑刚被别处改过，请稍后再试',
  // Captions.
  CAPTION_CONTEXT_MISMATCH: '字幕识别只能用于当前项目的剪辑',
  CAPTION_REQUEST_INVALID: '字幕识别的请求不完整：{detail}',
  CAPTION_TIMELINE_MISSING: '剪辑还没有保存过，先放一段素材再识别',
  CAPTION_TRACK_LOCKED: '字幕轨已锁定，先解锁再识别',
  CAPTION_CLIP_NOT_FOUND: '时间线上找不到要识别的片段：{detail}',
  CAPTION_TIMING_INVALID: '有片段的时长或变速设置不对，识别不了：{detail}',
  CAPTION_TIME_REMAP_UNSUPPORTED: '倒放或时间重映射的片段还不能识别原声',
  CAPTION_SOURCE_NOT_PINNED: '有片段的文件不在项目里，识别不了：{detail}',
  CAPTION_NO_AUDIBLE_SOURCE: '这个范围里没有能听到的原声（静音、或没有带声音的视频）',
  CAPTION_RANGE_TOO_LARGE: '一次最多识别 64 个片段、60 分钟原声，请缩小范围',
  CAPTION_REQUEST_CONFLICT: '这次识别请求和之前的冲突，请重新点一次',
  CAPTION_TASK_NOT_FOUND: '找不到这个识别任务',
  CAPTION_TASK_NOT_READY: '识别还没完成',
  CAPTION_DRAFT_MISSING: '这个任务没有字幕草稿',
  CAPTION_REVIEW_REQUIRED: '请先按原声核对草稿再应用',
  CAPTION_SEGMENT_NOT_FOUND: '要排除的句子不在草稿里，请重新打开草稿',
  CAPTION_NO_SPEECH: '没有可靠的人声字幕草稿，现有字幕未改动',
  CAPTION_SOURCE_CHANGED: '识别之后原声文件改过了，请重新识别',
  CAPTION_SOURCE_OUTSIDE_PROJECT: '原声文件不在项目里',
  CAPTION_SOURCE_INVALID: '原声文件读不了（不是文件，或超过 1 GB）',
  CAPTION_SOURCE_UNAVAILABLE: '识别页面读不到原声文件',
  CAPTION_PROTECTED_RANGE: '这个范围里已有校对过或手改过的字幕，草稿没有能写入的句子；要重写请先删掉旧字幕',
  CAPTION_RUNTIME_UNAVAILABLE: '本机识别需要一个打开着的 VibeDev 窗口（识别在窗口里的隐藏页面运行）',
  CAPTION_RUNTIME_LOST: '运行识别的窗口关掉了，识别中断，请重新识别',
  CAPTION_RUNTIME_FAILED: '识别页面出错：{detail}',
  CAPTION_RECOGNITION_FAILED: '识别失败：{detail}',
  CAPTION_RECOGNITION_TIMEOUT: '识别超过 45 分钟，已停止，请缩小范围',
  CAPTION_RESULT_INVALID: '识别结果不完整，字幕没有改动',
  CAPTION_MODEL_FAILED: '识别模型没能准备好：{detail}',
  // A request from an older page that still names a recognizer other than Whisper.
  CAPTION_ENGINE_UNSUPPORTED: '字幕只用本机 Whisper 识别，不再提供别的识别方式',
  VIDEO_EDITOR_MODEL_CONSENT_REQUIRED: '要先同意下载识别模型',
};

/** `FFMPEG_MISSING_FILTER` about captions, and about any other filter. */
const NO_SUBTITLES = '本机的 ffmpeg 没带 libass，字幕烧不进画面：在 dsh-film 设置的 ffmpegPath 指向一个完整版 ffmpeg，或先隐藏字幕轨再渲染';
const MISSING_FILTER = '本机的 ffmpeg 缺少渲染要用的滤镜：{detail}';

/** The planner's feature names, as `UNSUPPORTED_RENDER_FEATURE` lists them. */
const FEATURES: Readonly<Record<string, string>> = {
  'source audio': '视频自带的音轨',
  transitions: '这种转场',
  'visual effects': '这种视觉特效或滤镜',
  'caption effects': '这种字幕特效',
  'overlay masks': '叠加层遮罩',
  'overlay filters': '叠加层滤镜',
  'overlay animations': '叠加层动画',
  'overlay effects': '叠加层的分析效果',
  'overlay media types': '这种叠加素材',
  'sticker media types': '这种贴纸素材',
  'analysis effect transforms': '分析效果上的变换',
  'combined subject and depth effects': '主体和景深效果同用',
  'unresolved migration features': '还没迁移完的功能',
};

/** The code of a refusal, a task error or a thrown error, when it has one. */
export function codeOf(error: unknown): string | null {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : null;
  return typeof code === 'string' && code ? code : null;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  const message = error && typeof error === 'object' ? (error as { message?: unknown }).message : null;
  return typeof message === 'string' ? message : String(error);
}

/** What follows the plugin's explanation: the names, the list, the tail. */
function detailOf(message: string): string {
  const colon = message.indexOf(': ');
  return colon > 0 ? message.slice(colon + 2).trim() : message.trim();
}

function featuresOf(message: string): string {
  return detailOf(message)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => FEATURES[item] ?? item)
    .join('、');
}

/** The refusal's wording for the person: by code, specifics kept. */
export function describeRefusal(error: unknown): string {
  const message = messageOf(error);
  const code = codeOf(error);
  if (code === null) return message;
  if (code === 'FFMPEG_MISSING_FILTER') {
    return /subtitles|libass/i.test(message) ? NO_SUBTITLES : MISSING_FILTER.replace('{detail}', detailOf(message));
  }
  const wording = REFUSALS[code];
  if (wording === undefined) return message;
  const detail = code === 'UNSUPPORTED_RENDER_FEATURE' ? featuresOf(message) : detailOf(message);
  return wording.replace('{detail}', detail);
}
