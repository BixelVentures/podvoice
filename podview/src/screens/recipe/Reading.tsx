// Opskrifter, one recipe: the intro (photo or gallery trigger, summary, Start/Fortsæt/Afslut and Nulstil), the
// reading column (gallery, Ingredienser, Sådan gør du, Om opskriften) and the reset confirmation. Same anatomy as
// before. The controller (RecipeView.tsx) owns the cooking session; the gallery's place and the dialogs' open state
// stay with the page (native showModal/close).
import {useLayoutEffect, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import type {DetailedHTMLProps, HTMLAttributes} from 'react';
import type {Recipe, RecipeGroup} from './model';
import {Action, Dialog, Disclosure, keepFocusOnClose, kit, Meta, PageHeader, ReadOnlyRow, Section, Time} from './parts';
import {RecipePhoto} from './RecipePhoto';
import {openModal} from '../../lib/ui/modal';

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'pv-checklist': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

export type Fact = [label: string, value: string | {date: Date; text: string}];

export interface ReadingModel {
  recipe: Recipe;
  subtitle: string;
  // Whether this recipe is the one being cooked; the step that is next (−1: every step is done).
  active: boolean;
  current: number;
  progress: string;
  advanceLabel: string;
  advanceHidden: boolean;
  steps: string[];
  // The ids of the steps done and the ingredient lines found (»<group>-<line>«), in the order they were checked.
  completed: string[];
  ingredients: string[];
  ingredientsExpanded: boolean;
  groups: RecipeGroup[];
  isNew: boolean;
  coverUrl: string | null;
  images: (string | File)[];
  origin: string;
  facts: Fact[];
  completions: {date: Date; text: string}[];
}

export interface ReadingActions {
  advance: () => void;
  reset: () => void;
  toggleStep: (index: number) => void;
  toggleIngredient: (id: string) => void;
  toggleIngredients: (expanded: boolean, trigger: HTMLButtonElement, panel: HTMLElement) => void;
  // Slet opskrift; false when this device could not remember it (the dialog stays, with the error).
  remove: (close: () => void) => boolean;
}

interface ChecklistData {
  items: {label: string; id: string}[];
  checked: string[];
  connected: true;
  state: 'ready';
}
type ChecklistElement = HTMLElement & {data?: ChecklistData};

interface ChecklistProps {
  group: RecipeGroup;
  checked: string[];
  single: boolean;
  onToggle: (id: string) => void;
}

// One ingredient group: the shared pv-checklist, fed its data after the render (only when it changes), with the
// group's count beside its title. A single group shows no header.
function Checklist({group, checked, single, onToggle}: ChecklistProps) {
  const list = useRef<ChecklistElement>(null);
  const handler = useRef(onToggle);
  const items = group.lines.map((label, i) => ({label, id: `${group.title}-${String(i)}`}));
  const done = items.filter(item => checked.includes(item.id));
  const data: ChecklistData = {items, checked, connected: true, state: 'ready'};
  const signature = JSON.stringify(data);
  useLayoutEffect(() => {
    handler.current = onToggle;
  });
  useLayoutEffect(() => {
    if (list.current) list.current.data = JSON.parse(signature) as ChecklistData;
  }, [signature]);
  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    const ids = new Set(items.map(item => item.id));
    const choose = (event: Event) => {
      const detail = (event as CustomEvent<{action_id?: string; option_id?: string} | undefined>).detail;
      const id = detail?.option_id;
      if (detail?.action_id !== 'choose' || id === undefined || !ids.has(id)) return;
      event.stopPropagation();
      handler.current(id);
    };
    node.addEventListener('pv-action', choose);
    return () => {
      node.removeEventListener('pv-action', choose);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the item ids are the group's lines
  }, [JSON.stringify(group)]);
  return (
    <Section
      title={group.title}
      header={
        <header {...kit('sectionheader')} hidden={single}>
          <h3 data-kit-text="group-title">{group.title}</h3>
          <Meta role="status">
            {`${String(done.length)} af ${String(items.length)} fundet frem`}
          </Meta>
        </header>
      }
    >
      <pv-checklist aria-label={group.title} ref={list} />
    </Section>
  );
}

interface GalleryView {
  src: string;
  alt: string;
  position: string;
}

export function Reading({model, actions}: {model: ReadingModel; actions: ReadingActions}) {
  const {recipe, active, current, images} = model;
  const confirm = useRef<HTMLDialogElement>(null);
  const gallery = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const galleryAt = useRef({index: 0, url: null as string | null});
  const [view, setView] = useState<GalleryView | null>(null);
  const [failed, setFailed] = useState(false);
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Forrige / Næste / the trigger: the gallery shows one image at a time; a local file is shown by its object URL.
  const showImage = (offset: number) => {
    const at = galleryAt.current;
    at.index = (at.index + offset + images.length) % images.length;
    if (at.url) URL.revokeObjectURL(at.url);
    const image = images[at.index];
    if (image === undefined) return;
    at.url = typeof image === 'string' ? null : URL.createObjectURL(image);
    flushSync(() => {
      setFailed(false);
      setView({
        src: at.url ?? (image as string),
        alt: `Opskriftsbillede ${String(at.index + 1)}`,
        position: `${String(at.index + 1)} af ${String(images.length)}`,
      });
    });
    if (gallery.current && !gallery.current.open) openModal(gallery.current);
  };
  const single = images.length === 1;
  const photo = (
    <RecipePhoto
      src={recipe.image}
      objectUrl={model.coverUrl}
      clearAltOnError
      alt={model.coverUrl || recipe.image ? `Originalt billede til ${recipe.title}` : ''}
    />
  );

  const columns = (
    [
      ['Fakta', model.facts],
      ['Senest gennemført', model.completions.map(time => ['Gennemført', time] as Fact)],
    ] as const
  ).filter(([, items]) => items.length);

  return (
    <>
      <PageHeader title={recipe.title} subtitle="" />
      <article {...kit('hero')} data-recipe-layout="intro">
        {images.length ? (
          <button
            {...kit('button', {variant: 'secondary'})}
            type="button"
            data-recipe-layout="gallery-trigger"
            aria-haspopup="dialog"
            onClick={() => {
              showImage(0);
            }}
          >
            {photo}
            <Meta>{single ? 'Vis billede' : `${String(images.length)} billeder`}</Meta>
          </button>
        ) : (
          photo
        )}
        <header {...kit('sectionheader')} data-recipe-layout="summary">
          <p data-kit-text="section-title" data-recipe-layout="title" aria-hidden="true">
            {recipe.title}
          </p>
          {model.subtitle ? <p data-kit-text="section-title">{model.subtitle}</p> : null}
          {recipe.description ? <p data-kit-text="body">{recipe.description}</p> : null}
          {recipe.publisher ? <Meta>{`Af ${recipe.publisher}`}</Meta> : null}
          {model.isNew ? <Meta>Ny</Meta> : null}
          <Meta role="status">{model.progress}</Meta>
        </header>
        <div data-recipe-layout="controls">
          <Action label={model.advanceLabel} variant="primary" hidden={model.advanceHidden} onPress={actions.advance} />
          <Action
            label="Nulstil opskrift"
            hidden={!active}
            onPress={() => confirm.current && openModal(confirm.current)}
          />
        </div>
      </article>
      <div data-recipe-layout="reading">
        {images.length ? (
          <Dialog
            data-recipe-layout="gallery"
            aria-label={`Billeder af ${recipe.title}`}
            ref={gallery}
            onClose={() => {
              const at = galleryAt.current;
              if (at.url) URL.revokeObjectURL(at.url);
              at.url = null;
              at.index = 0;
            }}
          >
            <img
              referrerPolicy="no-referrer"
              hidden={failed}
              alt={view?.alt}
              src={view?.src}
              onError={() => {
                flushSync(() => {
                  setFailed(true);
                });
              }}
            />
            <Meta hidden={!failed}>Billedet kunne ikke indlæses.</Meta>
            <div className="pv-dialog-actions">
              <Action label="Forrige" hidden={single} onPress={() => { showImage(-1); }} />
              <Meta role="status" hidden={single}>
                {view?.position}
              </Meta>
              <Action label="Næste" hidden={single} onPress={() => { showImage(1); }} />
              <Action label="Luk" variant="primary" onPress={() => gallery.current?.close()} />
            </div>
          </Dialog>
        ) : null}
        <Disclosure
          id="recipe-ingredients"
          title="Ingredienser"
          titleRole="section-title"
          kitCard
          data-recipe-layout="ingredients"
          data-kit-layout="card-header"
          description={`${String(model.ingredients.length)} af ${String(
            model.groups.reduce((count, group) => count + group.lines.length, 0),
          )} fundet frem`}
          expanded={model.ingredientsExpanded}
          onToggle={actions.toggleIngredients}
        >
          {model.groups.map((group, index) => (
            <Checklist
              key={`${group.title}#${String(index)}`}
              group={group}
              checked={model.ingredients}
              single={model.groups.length === 1}
              onToggle={actions.toggleIngredient}
            />
          ))}
        </Disclosure>
        <Section title="Sådan gør du">
          <ol role="list">
            {model.steps.map((instruction, index) => (
              <Step
                key={index}
                index={index}
                instruction={instruction}
                phase={recipe.phases?.[index] ?? null}
                active={active}
                current={active && index === current}
                completed={model.completed.includes(String(index))}
                onToggle={actions.toggleStep}
              />
            ))}
          </ol>
        </Section>
        <Disclosure
          id="recipe-about"
          title="Om opskriften"
          description={model.origin}
          data-recipe-layout="source"
          expanded={aboutExpanded}
          onToggle={(expanded, trigger, panel) => {
            keepFocusOnClose(expanded, trigger, panel);
            flushSync(() => {
              setAboutExpanded(expanded);
            });
          }}
        >
          {columns.length ? (
            <div data-recipe-layout="source-columns">
              {columns.map(([heading, items]) => (
                <section key={heading}>
                  <h3 data-kit-text="group-title">{heading}</h3>
                  {items.map(([label, value], index) => (
                    <ReadOnlyRow key={index}>
                      <span data-kit-text="field-label">{label}</span>
                      {typeof value === 'string' ? <Meta>{value}</Meta> : <Time date={value.date} text={value.text} />}
                    </ReadOnlyRow>
                  ))}
                </section>
              ))}
            </div>
          ) : null}
          <Action
            label="Slet opskrift"
            variant="quiet"
            onPress={() => {
              flushSync(() => {
                setDeleteError('');
              });
              if (deleteDialog.current) openModal(deleteDialog.current);
            }}
          />
          <Dialog aria-labelledby="recipe-delete-title" ref={deleteDialog}>
            <header className="pv-dialog-header">
              <h2 id="recipe-delete-title">Slet opskrift?</h2>
            </header>
            <Meta className="pv-dialog-description">{`»${recipe.title}« fjernes fra kataloget på denne enhed.`}</Meta>
            <Meta role="alert">{deleteError}</Meta>
            <div className="pv-dialog-actions">
              <Action
                label="Annuller"
                // The dialog focuses Annuller when it opens (autofocus, never React's focus on mount).
                ref={node => {
                  if (node) node.autofocus = true;
                }}
                onPress={() => deleteDialog.current?.close()}
              />
              <Action
                label="Slet opskrift"
                variant="primary"
                tone="danger"
                onPress={() => {
                  if (actions.remove(() => deleteDialog.current?.close())) return;
                  flushSync(() => {
                    setDeleteError('Opskriften kunne ikke slettes. Prøv igen.');
                  });
                }}
              />
            </div>
          </Dialog>
        </Disclosure>
      </div>
      <Dialog aria-labelledby="recipe-stop-title" ref={confirm}>
        <header className="pv-dialog-header">
          <h2 id="recipe-stop-title">Nulstil opskrift?</h2>
        </header>
        <Meta className="pv-dialog-description">
          Alle ingrediens- og trinafkrydsninger ryddes. Opskriften bliver liggende i kataloget.
        </Meta>
        <div className="pv-dialog-actions">
          <Action label="Fortsæt madlavning" onPress={() => confirm.current?.close()} />
          <Action
            label="Nulstil"
            variant="primary"
            tone="danger"
            onPress={() => {
              confirm.current?.close();
              actions.reset();
            }}
          />
        </div>
      </Dialog>
    </>
  );
}

interface StepProps {
  index: number;
  instruction: string;
  phase: string | null;
  active: boolean;
  current: boolean;
  completed: boolean;
  onToggle: (index: number) => void;
}

// A step reads as text; while the recipe is being cooked it is a button that marks it done.
function Step({index, instruction, phase, active, current, completed, onToggle}: StepProps) {
  return (
    <li aria-current={current ? 'step' : undefined} data-completed={String(completed)}>
      <span data-kit-text="group-title" data-recipe-step-number="">
        {`${String(index + 1)}.`}
      </span>
      {phase ? <h3 data-kit-text="group-title">{phase}</h3> : null}
      <p data-kit-text="body" hidden={active}>
        {instruction}
      </p>
      <Action
        label={instruction}
        textRole="body"
        hidden={!active}
        aria-pressed={String(completed) as 'true' | 'false'}
        onPress={() => {
          onToggle(index);
        }}
      />
    </li>
  );
}
