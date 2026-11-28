import type { YouTubeClient } from '../src/youtube';

/** Test double for the YouTube client; records calls (method + query). */
export function fakeYouTube(over: Partial<YouTubeClient> = {}): YouTubeClient & { calls: { method: string; arg: unknown }[] } {
  const calls: { method: string; arg: unknown }[] = [];
  const base: YouTubeClient = {
    report: async () => ({ columns: [], rows: [] }),
    uploads: async () => [],
    video: async () => null,
    reportingJobs: async () => [],
    createReportingJob: async (_t, type) => ({ id: `job-${type}`, reportTypeId: type }),
    reportingFiles: async () => [],
    download: async () => '',
  };
  const m = { ...base, ...over };
  return {
    report: (t, q) => (calls.push({ method: 'report', arg: q }), m.report(t, q)),
    uploads: (t, n) => (calls.push({ method: 'uploads', arg: n }), m.uploads(t, n)),
    video: (t, id) => (calls.push({ method: 'video', arg: id }), m.video(t, id)),
    reportingJobs: (t) => (calls.push({ method: 'reportingJobs', arg: null }), m.reportingJobs(t)),
    createReportingJob: (t, type) => (calls.push({ method: 'createReportingJob', arg: type }), m.createReportingJob(t, type)),
    reportingFiles: (t, job, after) => (calls.push({ method: 'reportingFiles', arg: { job, after } }), m.reportingFiles(t, job, after)),
    download: (t, url) => (calls.push({ method: 'download', arg: url }), m.download(t, url)),
    calls,
  };
}
