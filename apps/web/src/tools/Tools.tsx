import { useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router';
import { Calculators } from './Calculators';
import { ChapterTool } from './ChapterTool';
import { TagTool } from './TagTool';
import { TranscriptTool } from './TranscriptTool';

const TABS = [['tags', 'Tags'], ['chapters', 'Chapters'], ['transcripts', 'Transcripts'], ['calculators', 'Calculators']] as const;

/** Tools (spec 9b): small tools on the user's own input. Nothing here costs server data. */
export function Tools() {
  const { tab = 'tags' } = useParams();
  const navigate = useNavigate();
  /** A looked-up video's description handed to the chapter checker. */
  const [handoff, setHandoff] = useState<{ description: string; lengthSeconds: number } | null>(null);
  return (
    <section className="screen">
      <div><h1>Tools</h1><p className="sub">Small tools on your own input. Nothing is stored on the server.</p></div>
      <div className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <NavLink key={id} to={`/tools/${id}`} role="tab" aria-selected={tab === id} className={`tab${tab === id ? ' on' : ''}`}>{label}</NavLink>
        ))}
      </div>
      {tab === 'chapters' ? <ChapterTool initial={handoff} />
        : tab === 'transcripts' ? <TranscriptTool />
          : tab === 'calculators' ? <Calculators />
            : <TagTool onChapters={(v) => { setHandoff(v); navigate('/tools/chapters'); }} />}
    </section>
  );
}

export const NEEDS_EXTENSION = 'This tool needs the ViewProof browser extension: it reads YouTube in your own browser. Install it (see the README), then reload this page.';
