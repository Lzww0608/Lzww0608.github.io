export function initializeFocusModality(): () => void {
  const usePointer = () => {
    document.documentElement.dataset.focusModality = 'pointer';
  };
  const useKeyboard = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || event.metaKey || event.ctrlKey || event.altKey) return;
    document.documentElement.dataset.focusModality = 'keyboard';
  };

  window.addEventListener('pointerdown', usePointer, true);
  window.addEventListener('keydown', useKeyboard, true);

  return () => {
    window.removeEventListener('pointerdown', usePointer, true);
    window.removeEventListener('keydown', useKeyboard, true);
  };
}
