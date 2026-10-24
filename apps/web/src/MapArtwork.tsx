import type { GameDefinitionView } from '@game/protocol';
import { resolveBoardPresentation } from './territories.js';
import paperGrain from './art/paper-grain.png';

// Fixed SVG artwork from the approved Terra en disputa mockup; interactive countries stay in GameMap.
const definitions =
  '\n    <marker id="chart-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path class="route-arrow" d="M0 0L8 4L0 8L2 4Z"/></marker>\n    <pattern id="chart-wave" width="54" height="34" patternUnits="userSpaceOnUse"><path d="M4 15q7-5 14 0t14 0M25 30q7-4 14 0" fill="none" stroke="var(--chart-grid)" stroke-width=".7" opacity=".28"/></pattern>\n    <radialGradient id="chart-age"><stop offset=".25" stop-color="var(--chart-cream)" stop-opacity="0"/><stop offset="1" stop-color="var(--chart-ornament)" stop-opacity=".2"/></radialGradient>\n    <linearGradient id="land-wash" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".2"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#513416" stop-opacity=".1"/></linearGradient>\n    \n    <clipPath id="chart-sea-clip"><rect x="93" y="49" width="1608" height="849"/></clipPath>\n    <g id="chart-vessel">\n      <path class="chart-fill" d="M-62 9Q-8 21 59 5L41 29Q-12 37-47 23Z"/>\n      <path class="chart-line" d="M-63 9L-72-1M55 8L70-4M-28 17V-52M9 20V-77M36 15V-39M-33-49H2M-8-68H29M21-37H51M-28-47L-55 8M9-75L-48 15M9-75L52 10M36-38L58 7"/>\n      <path class="chart-fill" d="M-24-46Q-4-52 0-42L-3-3Q-13-10-27-2ZM12-66Q35-61 35-51L29-15Q20-21 11-14ZM-7-60Q-23-47-17-20L6-14V-65ZM39-35Q53-32 57-20L51-3L38-9Z"/>\n      <path class="chart-line" d="M9-77q17-8 22 0q-13 5-22 0M-49 21q45 8 88 0M-36 26l74 0M-63 39q20-5 39 0t39 0t40 0M-44 47q22-4 44 0t35 0"/>\n      <path class="chart-solid" d="M-28-3h4v8h-4zm15 3h4v8h-4zm15 0h4v8h-4zm15 0h4v8h-4zm15-2h4v8h-4z"/>\n    </g>\n    <g id="chart-compass">\n      <circle class="chart-line" r="74"/><circle class="chart-line" r="65"/><circle class="chart-line" r="23"/>\n      <path transform="rotate(0)" d="M0-62L8-9L0 0L-8-9Z" fill="var(--chart-gold)" stroke="var(--chart-ornament)" stroke-width="1"/><path transform="rotate(22.5)" d="M0-46L8-9L0 0L-8-9Z" fill="var(--chart-paper)" stroke="var(--chart-ornament)" stroke-width="1"/><path transform="rotate(45)" d="M0-62L8-9L0 0L-8-9Z" fill="var(--chart-gold)" stroke="var(--chart-ornament)" stroke-width="1"/><path transform="rotate(67.5)" d="M0-46L8-9L0 0L-8-9Z" fill="var(--chart-paper)" stroke="var(--chart-ornament)" stroke-width="1"/><path transform="rotate(90)" d="M0-62L8-9L0 0L-8-9Z" fill="var(--chart-gold)" stroke="var(--chart-ornament)" stroke-width="1"/><path transform="rotate(112.5)" d="M0-46L8-9L0 0L-8-9Z" fill="var(--chart-paper)" stroke="var(--chart-ornament)" stroke-width="1"/><path transform="rotate(135)" d="M0-62L8-9L0 0L-8-9Z" fill="var(--chart-gold)" stroke="var(--chart-ornament)" stroke-width="1"/><path transform="rotate(157.5)" d="M0-46L8-9L0 0L-8-9Z" fill="var(--chart-paper)" stroke="var(--chart-ornament)" stroke-width="1"/><path transform="rotate(180)" d="M0-62L8-9L0 0L-8-9Z" fill="var(--chart-gold)" stroke="var(--chart-ornament)" stroke-width="1"/><path transform="rotate(202.5)" d="M0-46L8-9L0 0L-8-9Z" fill="var(--chart-paper)" stroke="var(--chart-ornament)" stroke-width="1"/><path transform="rotate(225)" d="M0-62L8-9L0 0L-8-9Z" fill="var(--chart-gold)" stroke="var(--chart-ornament)" stroke-width="1"/><path transform="rotate(247.5)" d="M0-46L8-9L0 0L-8-9Z" fill="var(--chart-paper)" stroke="var(--chart-ornament)" stroke-width="1"/><path transform="rotate(270)" d="M0-62L8-9L0 0L-8-9Z" fill="var(--chart-gold)" stroke="var(--chart-ornament)" stroke-width="1"/><path transform="rotate(292.5)" d="M0-46L8-9L0 0L-8-9Z" fill="var(--chart-paper)" stroke="var(--chart-ornament)" stroke-width="1"/><path transform="rotate(315)" d="M0-62L8-9L0 0L-8-9Z" fill="var(--chart-gold)" stroke="var(--chart-ornament)" stroke-width="1"/><path transform="rotate(337.5)" d="M0-46L8-9L0 0L-8-9Z" fill="var(--chart-paper)" stroke="var(--chart-ornament)" stroke-width="1"/>\n      <path class="chart-line" transform="rotate(0)" d="M0-65V-74"/><path class="chart-line" transform="rotate(11.25)" d="M0-65V-69"/><path class="chart-line" transform="rotate(22.5)" d="M0-65V-69"/><path class="chart-line" transform="rotate(33.75)" d="M0-65V-69"/><path class="chart-line" transform="rotate(45)" d="M0-65V-74"/><path class="chart-line" transform="rotate(56.25)" d="M0-65V-69"/><path class="chart-line" transform="rotate(67.5)" d="M0-65V-69"/><path class="chart-line" transform="rotate(78.75)" d="M0-65V-69"/><path class="chart-line" transform="rotate(90)" d="M0-65V-74"/><path class="chart-line" transform="rotate(101.25)" d="M0-65V-69"/><path class="chart-line" transform="rotate(112.5)" d="M0-65V-69"/><path class="chart-line" transform="rotate(123.75)" d="M0-65V-69"/><path class="chart-line" transform="rotate(135)" d="M0-65V-74"/><path class="chart-line" transform="rotate(146.25)" d="M0-65V-69"/><path class="chart-line" transform="rotate(157.5)" d="M0-65V-69"/><path class="chart-line" transform="rotate(168.75)" d="M0-65V-69"/><path class="chart-line" transform="rotate(180)" d="M0-65V-74"/><path class="chart-line" transform="rotate(191.25)" d="M0-65V-69"/><path class="chart-line" transform="rotate(202.5)" d="M0-65V-69"/><path class="chart-line" transform="rotate(213.75)" d="M0-65V-69"/><path class="chart-line" transform="rotate(225)" d="M0-65V-74"/><path class="chart-line" transform="rotate(236.25)" d="M0-65V-69"/><path class="chart-line" transform="rotate(247.5)" d="M0-65V-69"/><path class="chart-line" transform="rotate(258.75)" d="M0-65V-69"/><path class="chart-line" transform="rotate(270)" d="M0-65V-74"/><path class="chart-line" transform="rotate(281.25)" d="M0-65V-69"/><path class="chart-line" transform="rotate(292.5)" d="M0-65V-69"/><path class="chart-line" transform="rotate(303.75)" d="M0-65V-69"/><path class="chart-line" transform="rotate(315)" d="M0-65V-74"/><path class="chart-line" transform="rotate(326.25)" d="M0-65V-69"/><path class="chart-line" transform="rotate(337.5)" d="M0-65V-69"/><path class="chart-line" transform="rotate(348.75)" d="M0-65V-69"/>\n      <circle class="chart-fill" r="10"/><circle class="chart-solid" r="3"/>\n      <path class="chart-fill" d="M0-110q-12 9-5 18q-15-12-17 1q-1 11 16 8L0-69L6-83q17 3 16-8q-2-13-17-1q7-9-5-18Z"/>\n      <text class="chart-text" y="98" font-size="15" letter-spacing="5">S</text><text class="chart-text" x="94" y="5" font-size="15">E</text><text class="chart-text" x="-94" y="5" font-size="15">O</text>\n    </g>\n  ';
const background =
  '\n    <rect x="72" y="28" width="1650" height="891" rx="3" fill="var(--chart-paper)"/>\n    <rect x="93" y="49" width="1608" height="849" fill="var(--chart-sea)"/>\n    <rect x="94" y="50" width="1606" height="847" fill="url(#chart-wave)"/>\n    <rect x="74" y="30" width="1646" height="887" fill="url(#chart-age)"/>\n    <g class="chart-rhumbs">\n      <path d="M95 260H1699M95 473H1699M95 686H1699M363 50V897M630 50V897M897 50V897M1164 50V897M1431 50V897"/>\n      <path d="M95 50L1700 898M1700 50L95 898M95 473Q897-215 1700 473Q897 1160 95 473M897 50Q240 473 897 898Q1554 473 897 50"/>\n    </g>\n    <g class="chart-rhumbs chart-rhumbs-copper only-copper">\n      <circle cx="897" cy="473" r="405"/><circle cx="897" cy="473" r="350"/><ellipse cx="897" cy="473" rx="735" ry="405"/>\n      <path d="M127 80h6m-3-3v6"/><path d="M264 163h6m-3-3v6"/><path d="M401 246h6m-3-3v6"/><path d="M538 329h6m-3-3v6"/><path d="M675 412h6m-3-3v6"/><path d="M812 495h6m-3-3v6"/><path d="M949 578h6m-3-3v6"/><path d="M1086 661h6m-3-3v6"/><path d="M1223 744h6m-3-3v6"/><path d="M1360 827h6m-3-3v6"/><path d="M1497 160h6m-3-3v6"/><path d="M1634 243h6m-3-3v6"/><path d="M251 326h6m-3-3v6"/><path d="M388 409h6m-3-3v6"/><path d="M525 492h6m-3-3v6"/><path d="M662 575h6m-3-3v6"/><path d="M799 658h6m-3-3v6"/><path d="M936 741h6m-3-3v6"/><path d="M1073 824h6m-3-3v6"/><path d="M1210 157h6m-3-3v6"/><path d="M1347 240h6m-3-3v6"/><path d="M1484 323h6m-3-3v6"/><path d="M1621 406h6m-3-3v6"/><path d="M238 489h6m-3-3v6"/><path d="M375 572h6m-3-3v6"/><path d="M512 655h6m-3-3v6"/><path d="M649 738h6m-3-3v6"/><path d="M786 821h6m-3-3v6"/>\n    </g>\n  ';
const ornaments =
  '\n    <rect x="73" y="29" width="1648" height="889" class="chart-frame"/>\n    <rect x="82" y="38" width="1630" height="871" class="chart-frame"/>\n    <rect x="92" y="48" width="1610" height="851" class="chart-frame chart-frame-inner"/>\n    <g transform="translate(74 30) scale(1 1)"><path class="chart-line" d="M5 56V5H56M13 48V13H48M20 40Q25 20 40 20M5 5L42 42"/><circle class="chart-fill" cx="30" cy="30" r="8"/></g><g transform="translate(1720 30) scale(-1 1)"><path class="chart-line" d="M5 56V5H56M13 48V13H48M20 40Q25 20 40 20M5 5L42 42"/><circle class="chart-fill" cx="30" cy="30" r="8"/></g><g transform="translate(74 917) scale(1 -1)"><path class="chart-line" d="M5 56V5H56M13 48V13H48M20 40Q25 20 40 20M5 5L42 42"/><circle class="chart-fill" cx="30" cy="30" r="8"/></g><g transform="translate(1720 917) scale(-1 -1)"><path class="chart-line" d="M5 56V5H56M13 48V13H48M20 40Q25 20 40 20M5 5L42 42"/><circle class="chart-fill" cx="30" cy="30" r="8"/></g>\n    <g class="only-board">\n      <path class="chart-fill" d="M130 60H543L534 78L543 96H130L141 78Z"/>\n      <text class="chart-text" x="336" y="84" font-size="23" letter-spacing="4">TERRA · MARE · IMPERIVM</text>\n      <use href="#chart-compass" transform="translate(285 610) scale(.95)"/>\n      <use href="#chart-vessel" transform="translate(747 698) scale(.68)"/>\n      <use href="#chart-vessel" transform="translate(1180 785) scale(.5)"/>\n      <text class="chart-ocean chart-ocean-west" data-sea-label x="265" y="485">OCEANVS OCCIDENTALIS</text>\n      <text class="chart-ocean chart-ocean-north" data-sea-label x="865" y="75">MARE BOREALE</text>\n      <text class="chart-ocean chart-ocean-east" data-sea-label x="1560" y="545">MARE ORIENTALE</text>\n    </g>\n    <g class="only-copper">\n      <path class="chart-fill" d="M130 60H543L534 78L543 96H130L141 78Z"/>\n      <text class="chart-text" x="336" y="84" font-size="23" letter-spacing="4">TERRA · MARE · IMPERIVM</text>\n      <circle class="chart-line" cx="285" cy="610" r="111"/><circle class="chart-line" cx="285" cy="610" r="118" stroke-dasharray="2 8"/>\n      <use href="#chart-compass" transform="translate(285 610) scale(1.08)"/>\n      <use href="#chart-vessel" transform="translate(747 698) scale(.75)"/>\n      <text class="chart-ocean chart-ocean-north" data-sea-label x="865" y="75">MARE BOREALE</text>\n      <text class="chart-ocean chart-ocean-east" data-sea-label x="1560" y="545">MARE ORIENTALE</text>\n      <text class="chart-ocean chart-ocean-west" data-sea-label x="265" y="485">OCEANVS OCCIDENTALIS</text>\n      <g class="chart-line" opacity=".55">\n        <path d="M1515 90h12m-6-6v12M1565 115h9m-4.5-4.5v9M1620 85h14m-7-7v14M1535 125l-14-29l44 19l55-30"/>\n        <circle cx="1521" cy="96" r="2"/><circle cx="1569.5" cy="115" r="2"/><circle cx="1627" cy="85" r="2"/>\n      </g>\n      <g transform="translate(1198 809)"><circle class="chart-line" r="31"/><path d="M3-30a31 31 0 1 0 0 60a24 31 0 0 1 0-60Z" fill="var(--chart-gold)" opacity=".65"/><path class="chart-line" d="M-46 0h-8m108 0h-8M0-46v-8m0 108v-8"/></g>\n    </g>\n    <g transform="translate(897 858)">\n      <path class="chart-fill" d="M-241-10H241L230 13L241 40H-241L-229 13Z"/>\n      <path class="chart-line" d="M-226-2H226M-223 33H223"/>\n      <text class="chart-text" data-chart-title y="24" font-size="23" letter-spacing="5">TABVLA TERRARVM</text>\n      <text class="chart-text" data-chart-year y="58" font-size="10" letter-spacing="3">PER TERRAS ET MARIA · MDCII</text>\n    </g>\n    <g fill="var(--chart-paper)" stroke="var(--chart-ornament)" stroke-width="1.2">\n      <circle cx="94" cy="175" r="12"/><circle cx="1700" cy="175" r="12"/><circle cx="94" cy="825" r="12"/><circle cx="1700" cy="825" r="12"/>\n    </g>\n    <g class="chart-text" font-size="14" font-weight="bold"><text x="94" y="180">A</text><text x="1700" y="180">A</text><text x="94" y="830">B</text><text x="1700" y="830">B</text></g>\n    <text class="chart-text" x="897" y="943" font-size="12" letter-spacing="1">A · ALASKA ↔ KAMTCHATKA    B · CHILE ↔ AUSTRALIA</text>\n    <rect class="chart-paper-texture" x="74" y="30" width="1646" height="887" fill="url(#paper-grain)"/>\n  ';

export function MapArtwork({
  part,
  definition,
}: {
  readonly definition: GameDefinitionView;
  readonly part: 'definitions' | 'background' | 'wash' | 'ornaments';
}) {
  const { territories: TERRITORIES } = resolveBoardPresentation(definition);
  const coastline = TERRITORIES.map((t) => t.path).join('');
  if (part === 'definitions')
    return (
      <>
        <defs dangerouslySetInnerHTML={{ __html: definitions }} />
        <defs>
          {/* Paper grain as a ready-made tile instead of a noise filter, so
              zooming never waits for it to be recomputed. */}
          <pattern
            id="paper-grain"
            width="200"
            height="200"
            patternUnits="userSpaceOnUse"
          >
            <image href={paperGrain} width="200" height="200" />
          </pattern>
          <clipPath id="chart-land-clip">
            {TERRITORIES.map((t) => (
              <path key={t.id} d={t.path} />
            ))}
          </clipPath>
        </defs>
      </>
    );
  if (part === 'background')
    return (
      <>
        <g
          className="chart-decoration"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: background }}
        />
        {/* The coastal shadow is three soft strokes around the land, not a
            filter, so it shows at once at every zoom. */}
        <g className="chart-coastal-halo" aria-hidden="true">
          {['wide', 'middle', 'narrow'].map((width) => (
            <path key={width} className={`coast-${width}`} d={coastline} />
          ))}
        </g>
      </>
    );
  if (part === 'wash')
    return (
      <g
        className="chart-wash"
        clipPath="url(#chart-land-clip)"
        aria-hidden="true"
      >
        <rect width="1760" height="960" fill="url(#land-wash)" />
      </g>
    );
  return (
    <g
      className="chart-decoration"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ornaments }}
    />
  );
}
