import { useEffect } from 'react';
import classicLogo from './assets/logos/ted-clasico.svg';
import competitiveLogo from './assets/logos/ted-competitivo.svg';
import reconquistaLogo from './assets/logos/ted-reconquista.svg';

export type LogoMode = 'classic' | 'competitive' | 'reconquista';

const LOGOS: Record<LogoMode, string> = {
  classic: classicLogo,
  competitive: competitiveLogo,
  reconquista: reconquistaLogo,
};

/** The mode's logo, sized like a roster seat so the bar keeps its height. */
export function ModeLogo({ mode }: { mode: LogoMode }) {
  return (
    <img
      className="mode-logo"
      src={LOGOS[mode]}
      alt=""
      width={34}
      height={34}
    />
  );
}

/** Shows the mode's logo as the tab icon while a game is open. */
export function useModeFavicon(mode: LogoMode) {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;
    const previous = link.href;
    link.href = LOGOS[mode];
    return () => {
      link.href = previous;
    };
  }, [mode]);
}
