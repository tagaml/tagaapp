import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Hauteur réelle du clavier, en pixels.
 *
 * POURQUOI CE HOOK EXISTE (le piège Android)
 * `KeyboardAvoidingView` ne fonctionne PAS à l'intérieur d'un `Modal` sur Android : un Modal est
 * une FENÊTRE SÉPARÉE, et le `adjustResize` du manifeste ne s'y applique pas. Le clavier vient
 * donc recouvrir le contenu — c'est exactement ce qui masquait la saisie du code de remise sur
 * l'écran de livraison.
 * En mesurant le clavier nous-mêmes et en ajoutant sa hauteur en marge basse, la feuille remonte
 * réellement, dans un Modal comme ailleurs, sur Android comme sur iOS.
 */
export function useKeyboardHeight(): number {
  const [hauteur, setHauteur] = useState(0);

  useEffect(() => {
    // iOS : `willShow` suit l'animation du clavier (la feuille monte avec lui, sans à-coup).
    // Android : seuls les évènements `did*` existent.
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = Keyboard.addListener(showEvt as any, (e: any) => {
      setHauteur(e?.endCoordinates?.height ?? 0);
    });
    const onHide = Keyboard.addListener(hideEvt as any, () => setHauteur(0));

    return () => { onShow.remove(); onHide.remove(); };
  }, []);

  return hauteur;
}
