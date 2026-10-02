// Phase 1 mock data. Replaced by real backend results from Phase 2/3 onward.
import type { AiClip, MediaAsset, TimelineDoc, Word } from '../types/editor'
import { rng } from '../lib/time'

export const SAMPLE_MEDIA: MediaAsset = {
  id: 'media_sample',
  name: 'podcast_episode_42.mp4',
  src: `${import.meta.env.BASE_URL}mock/sample.mp4`,
  duration: 120,
  width: 1280,
  height: 720,
  status: 'ready',
}

const SENTENCES = [
  'Nobody talks about the biggest mistake I made in my first year.',
  'I spent every dollar on ads and got exactly zero customers.',
  'Here is the truth, the product was the problem, not the marketing.',
  'So we stopped everything and called fifty users in one week.',
  'What they told us was honestly insane.',
  'They loved one tiny feature we almost deleted.',
  'We rebuilt the whole company around that idea.',
  'Six months later we crossed one million in revenue.',
  'And the crazy part is it was free to build.',
  'If you remember one thing, talk to your users before you spend money.',
  'Everyone wants the secret, but there is no secret.',
  'You just have to be willing to be wrong in public.',
  'My cofounder laughed at me when I said that.',
  'Now he says it on every podcast we do.',
]

const CLIP_META: Omit<AiClip, 'id' | 'mediaId' | 'srcStart' | 'srcEnd' | 'selected'>[] = [
  { title: 'The $0 Customer Mistake', score: 94, reason: 'Opens with a confession hook and a concrete loss, then pays off with a lesson.', hashtags: ['#startup', '#founder', '#business'] },
  { title: 'We Almost Deleted Our Best Feature', score: 91, reason: 'Surprising reversal with a clear story arc and a big number payoff.', hashtags: ['#product', '#startuplife', '#saas'] },
  { title: 'There Is No Secret', score: 87, reason: 'Strong contrarian opinion delivered in one quotable line.', hashtags: ['#motivation', '#entrepreneur'] },
  { title: 'Call 50 Users In A Week', score: 83, reason: 'Actionable tactic with urgency; audio energy spikes on the reveal.', hashtags: ['#growth', '#customerresearch'] },
  { title: 'From Zero To $1M', score: 79, reason: 'Big-number transformation story; scene change aligns with the payoff.', hashtags: ['#success', '#revenue', '#founderstory'] },
  { title: 'Be Wrong In Public', score: 74, reason: 'Emotional vulnerability moment followed by laughter.', hashtags: ['#mindset', '#leadership'] },
  { title: 'My Cofounder Laughed At Me', score: 70, reason: 'Humor and a callback payoff; good loop potential.', hashtags: ['#funny', '#cofounder'] },
  { title: 'Product Problem, Not Marketing', score: 66, reason: 'Clear opinion, but the hook lands a few seconds late.', hashtags: ['#marketing', '#productmarketfit'] },
  { title: 'Free To Build', score: 61, reason: 'Surprising fact, moderate energy, short payoff.', hashtags: ['#nocode', '#bootstrapped'] },
  { title: 'Talk To Your Users', score: 58, reason: 'Solid advice, lower novelty; works as a closing clip.', hashtags: ['#advice', '#startuptips'] },
  { title: 'What Users Told Us', score: 54, reason: 'Curiosity gap hook, but payoff is spread over a long section.', hashtags: ['#ux', '#feedback'] },
  { title: 'Rebuilding Around One Idea', score: 50, reason: 'Decent story beat; weaker opening line.', hashtags: ['#pivot', '#strategy'] },
]

export function mockClips(count: number, mediaId = SAMPLE_MEDIA.id, mediaDuration = SAMPLE_MEDIA.duration): AiClip[] {
  const r = rng(7)
  return CLIP_META.slice(0, count).map((meta, i) => {
    const len = 18 + Math.round(r() * 40)
    const srcStart = Math.round(r() * Math.max(0, mediaDuration - len))
    return { ...meta, id: `clip_${i + 1}`, mediaId, srcStart, srcEnd: srcStart + len, selected: meta.score >= 70 }
  })
}

function mockWords(duration: number, seed: number): Word[] {
  const r = rng(seed)
  const words: Word[] = []
  let t = 0.2
  let si = seed % SENTENCES.length
  while (t < duration - 1) {
    for (const text of SENTENCES[si % SENTENCES.length].split(' ')) {
      const len = 0.18 + r() * 0.28
      if (t + len > duration - 0.3) break
      words.push({ id: `w_${seed}_${words.length}`, text, start: +t.toFixed(2), end: +(t + len).toFixed(2) })
      t += len + 0.04 + r() * 0.08
    }
    t += 0.4 + r() * 0.6
    si++
  }
  return words
}

export function mockDoc(clip: AiClip, seed: number): TimelineDoc {
  const duration = clip.srcEnd - clip.srcStart
  return {
    video: [{ id: `v_${clip.id}`, mediaId: clip.mediaId, start: 0, end: duration, srcStart: clip.srcStart, volume: 1 }],
    // Stored in source time (see lib/timelineWords.ts).
    words: mockWords(duration, seed).map((w) => ({ ...w, start: w.start + clip.srcStart, end: w.end + clip.srcStart })),
    texts: [
      {
        id: `t_${clip.id}`,
        start: 0,
        end: Math.min(3, duration),
        text: clip.title,
        fontFamily: 'Poppins',
        fontSize: 64,
        color: '#ffffff',
        background: '#e2366f',
        x: 0.5,
        y: 0.16,
        isHook: true,
      },
    ],
    audio: [],
    framing: { mode: 'track', focusX: 0.5, zoom: 1 },
    progressBar: true,
  }
}

