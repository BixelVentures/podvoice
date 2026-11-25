// The recipe pieces of the kit (Recipe.tsx) with the canvas's own sample content (A-Opskrifter, Opskrifter-Bog,
// A-Opskrift, Opskrift-TimerKoerer). No photos are shipped: every photo is the recipe's ground.
import {useState} from 'react';
import {Button} from '../Button';
import {SectionTitle} from '../Controls';
import {
  CheckRow, CoverFlow, PortionStepper, RecipeCard, RecipeHero, RecipeTextKey, ResumeBand, ResumeLine, StepRow,
  StepTimer,
} from '../Recipe';
import {StickyLine} from '../Domain';
import {Card} from '../surfaces';

const noop = () => undefined;

const COVERS = [
  ['Burgerboller', 'Brød og bagværk', '15 stk. · 2–3 timer hævning'],
  ['Chokoladegranola', 'Morgenmad', '1 stort glas · 20–30 min. bagetid'],
  ['Hjemmelavede müslibarer', 'Madpakker', 'Ca. 15 stk. · 1 time i alt'],
  ['Koldhævede hytteostboller', 'Brød og bagværk', '15 stk. · hæver natten over'],
  ['Kylling i karry', 'Aftensmad', '4 personer · 45 min. i alt'],
  ['Pizzaboller med hytteost', 'Madpakker', '8–10 stk. · 35 min. i alt'],
  ['Protein bagels med hytteost', 'Brød og bagværk', '4 bagels · ingen hævetid'],
  ['Scones med hytteost og blåbær', 'Brød og bagværk', '9 stk. · 30 min. i alt'],
  ['Nem chokoladekage i bradepande', 'Desserter', '1 kage · 120 min.'],
].map(([title = '', kicker = '', meta = ''], index) => ({id: title, title, kicker, meta,
  badge: index === 0 ? 'I gang · trin 2 af 5' : null}));

export function RecipeGallery() {
  const [cover, setCover] = useState(0);
  const [count, setCount] = useState(15);
  return (
    <section aria-label="Opskrifter" className="flex w-[1132px] flex-col gap-6">
      <div data-gallery="recipe-band" className="flex flex-col gap-4">
        <ResumeBand title="Burgerboller · trin 2 af 5 · hvile og hævning" action="Fortsæt madlavning"
          aria-label="Fortsæt Burgerboller, Trin 2 af 5" onPress={noop} />
        <ResumeLine text="Burgerboller er i gang · trin 2 af 5" action="Gå til" aria-label="Gå til Burgerboller"
          onPress={noop} />
      </div>
      <div data-gallery="recipe-cards" className="grid grid-cols-5 gap-4">
        <RecipeCard title="Burgerboller" meta="15 stk. · 2–3 timer hævning" publisher="Meyers" active
          onPress={noop} />
        <RecipeCard title="Hjemmelavede müslibarer" meta="Ca. 15 stk. · 1 time i alt" publisher="Frederikke Wærens"
          onPress={noop} />
        <RecipeCard title="Nem chokoladekage i bradepande" meta="1 kage · 120 min."
          publisher="Udviklet i Arlas Inspirationskøkken" onPress={noop} />
        <RecipeCard title="Kylling i karry" meta="4 personer · 45 min. i alt" onPress={noop} />
      </div>
      <div data-gallery="recipe-hero">
        <RecipeHero title="Burgerboller" label="Trin 2 af 5 · af Meyers"
          facts="12–15 min. bagetid · 2–3 timer hævning · bløde sesamboller">
          <PortionStepper value={count} unit="stk." min={5} max={40} step={5} onChange={setCount} />
          <RecipeTextKey onPress={noop}>Nulstil opskrift</RecipeTextKey>
        </RecipeHero>
      </div>
      <div className="grid grid-cols-[400px_minmax(0,1fr)] items-start gap-4">
        <div data-gallery="recipe-checks">
          <Card tone="kit" inset="none" className="flex flex-col gap-1.5 p-6">
            <SectionTitle>Ingredienser</SectionTitle>
            <CheckRow amount="350 ml" text="koldt vand" isSelected onChange={noop} />
            <CheckRow amount="15 g" text="gær" isSelected={false} onChange={noop} />
            <CheckRow amount="840 g" text="hvedemel" scaled isSelected={false} onChange={noop} />
            <CheckRow amount={null} text="Sesamfrø" isSelected={false} onChange={noop} />
          </Card>
        </div>
        <div data-gallery="recipe-steps">
          <Card tone="kit" inset="none" className="flex flex-col gap-2.5 p-6">
            <SectionTitle>Sådan gør du</SectionTitle>
            <StepRow number={1} heading="Ælting" state="done" onToggle={noop}
              text="Ælt dejen i hånden eller på maskine, til den er glat og slipper skålen." />
            <StepRow number={2} heading="Hvile og hævning" state="current" onToggle={noop}
              text="Dæk dejen til, og lad den hvile 30–60 min. på bordet eller natten over på køl."
              timer={<StepTimer duration="30 min" current onStart={noop} />} />
            <StepRow number={3} heading="Efterhævning" state="todo" onToggle={noop}
              text="Dæk bollerne til, og lad dem hæve 2–3 timer."
              timer={<StepTimer duration="2 t" current={false} onStart={noop} />} />
            <StepRow number={4} heading="Bagning" state="todo" onToggle={noop}
              text="Bag ved 220 °C i 12–15 min."
              timer={<StepTimer duration="12 min" current={false} running={{count: '29:12', left: 0.97}}
                onStart={noop} />} />
          </Card>
        </div>
      </div>
      <div data-gallery="recipe-sticky" className="h-24">
        <StickyLine isShown surface="recipe" dot="recipe" label="Burgerboller, opskriften" title="Burgerboller"
          sub="Trin 2 af 5 · 15 stk." primary={<Button variant="primaer" size={44}>Afslut opskrift</Button>} />
      </div>
      <div data-gallery="recipe-coverflow" className="overflow-hidden">
        <CoverFlow aria-label="Udforsk opskrifter" items={COVERS} index={cover} onIndexChange={setCover}
          onOpen={noop} />
      </div>
    </section>
  );
}
