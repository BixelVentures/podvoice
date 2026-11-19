// A recipe photo: the decoded source photo or, until it is ready (or if it fails), the canvas placeholder. The photo
// is written to the <img> after the render (photo.ts), and only when its source changes. A photo of a local file is
// its object URL. On failure the placeholder stands in, once (and, for the recipe's own photo, without an alt).
import {useLayoutEffect, useRef} from 'react';
import type {ImgHTMLAttributes} from 'react';
import {fallBackOnError, showPhoto} from './photo';

interface RecipePhotoProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string | undefined;
  objectUrl?: string | null;
  clearAltOnError?: boolean;
}

export function RecipePhoto({src, objectUrl, clearAltOnError, ...rest}: RecipePhotoProps) {
  const image = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const img = image.current;
    if (!img) return;
    if (objectUrl) {
      img.src = objectUrl;
      img.referrerPolicy = 'no-referrer';
    } else showPhoto(img, src);
    fallBackOnError(
      img,
      clearAltOnError
        ? () => {
            img.alt = '';
          }
        : undefined,
    );
  }, [src, objectUrl, clearAltOnError]);
  return <img ref={image} {...rest} />;
}
