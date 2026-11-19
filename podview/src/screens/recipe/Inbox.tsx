// Opskrifter, Indbakke: sources added in this browser view (a link or photos of a recipe) and the form that adds one
// or writes its recipe text. Kept as it was; nothing on the wall screen opens it today.
import {useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import type {ReactNode} from 'react';
import type {RecipeSource} from './model';
import {Action, Disclosure, kit, Meta, PageHeader, Section} from './parts';

function SourceLinks({source}: {source: RecipeSource}) {
  return (
    <>
      {source.url ? (
        <a href={source.url} target="_blank" rel="noopener noreferrer">
          Åbn originalt link
        </a>
      ) : null}
      {source.files.map((file, index) => (
        <Meta key={index}>{file.name}</Meta>
      ))}
    </>
  );
}

function SourceRow({source, children}: {source: RecipeSource; children: ReactNode}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Disclosure
      id={`recipe-source-${String(source.id)}`}
      title={source.title ?? ''}
      description={source.recipe ? 'Gemt i kataloget' : 'Klar til gennemgang'}
      expanded={expanded}
      onToggle={next => {
        flushSync(() => {
          setExpanded(next);
        });
      }}
    >
      <SourceLinks source={source} />
      {children}
    </Disclosure>
  );
}

export interface InboxActions {
  add: () => void;
  open: (source: RecipeSource) => void;
  write: (source: RecipeSource) => void;
}

export function Inbox({sources, actions}: {sources: RecipeSource[]; actions: InboxActions}) {
  return (
    <>
      <PageHeader
        title="Indbakke"
        subtitle="Lokale kilder"
        actions={<Action label="Tilføj kilde" variant="primary" onPress={actions.add} />}
      />
      {sources.length ? null : (
        <Section title="Ingen kilder endnu">
          <Meta>Tilføj et link eller billeder af en opskrift.</Meta>
        </Section>
      )}
      {sources.map((source, index) => (
        <SourceRow key={index} source={source}>
          {source.recipe ? (
            <Action
              label="Åbn opskrift"
              onPress={() => {
                actions.open(source);
              }}
            />
          ) : (
            <Action
              label="Tilføj opskriftstekst"
              onPress={() => {
                actions.write(source);
              }}
            />
          )}
        </SourceRow>
      ))}
    </>
  );
}

export interface ImportFields {
  title?: string;
  ingredients?: string;
  steps?: string;
  url?: string;
  files?: File[];
}

type Field = [key: keyof ImportFields, label: string, tag: 'input' | 'textarea'];
const TEXT_FIELDS: Field[] = [
  ['title', 'Titel', 'input'],
  ['ingredients', 'Ingredienser · én pr. linje', 'textarea'],
  ['steps', 'Fremgangsmåde · ét trin pr. linje', 'textarea'],
];
const SOURCE_FIELDS: Field[] = [
  ['url', 'Link til original', 'input'],
  ['files', 'Billeder af original', 'input'],
];

interface ImportProps {
  source: RecipeSource | null;
  feedback: string;
  // Returns the problem to show, or nothing when the source or recipe was saved.
  onSubmit: (fields: ImportFields) => void;
}

export function ImportSource({source, feedback, onSubmit}: ImportProps) {
  const form = useRef<HTMLFormElement>(null);
  const schema = source ? TEXT_FIELDS : SOURCE_FIELDS;
  const read = () => {
    const fields: ImportFields = {};
    const controls = form.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea') ?? [];
    schema.forEach(([key], index) => {
      const control = controls[index];
      if (!control) return;
      if (key === 'files') fields.files = [...((control as HTMLInputElement).files ?? [])];
      else fields[key] = control.value;
    });
    return fields;
  };
  const body = (
    <form
      ref={form}
      onSubmit={event => {
        event.preventDefault();
        onSubmit(read());
      }}
    >
      {schema.map(([key, label, tag]) => (
        <label key={key}>
          {label}
          {tag === 'textarea' ? (
            <textarea />
          ) : key === 'url' ? (
            <input type="url" />
          ) : key === 'files' ? (
            <input type="file" accept="image/*" multiple />
          ) : (
            <input />
          )}
        </label>
      ))}
      <button {...kit('button', {variant: 'primary'})} type="submit">
        {source ? 'Gem opskrift' : 'Gem kilde'}
      </button>
      <Meta role="status">{feedback}</Meta>
    </form>
  );
  return (
    <>
      <PageHeader title={source ? 'Tilføj opskriftstekst' : 'Tilføj kilde'} subtitle="Gemmes i denne browservisning" />
      {source ? (
        <Section title="Original">
          <SourceLinks source={source} />
        </Section>
      ) : null}
      <Section title={source ? 'Opskrift' : 'Original'}>{body}</Section>
    </>
  );
}
