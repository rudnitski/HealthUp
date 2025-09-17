(() => {
  const fileInput = document.querySelector('#file-input');
  const messageEl = document.querySelector('#file-message');

  if (!fileInput || !messageEl) {
    return;
  }

  const updateMessage = (fileName) => {
    if (fileName) {
      messageEl.textContent = `You selected: ${fileName}`;
      messageEl.hidden = false;
    } else {
      messageEl.textContent = '';
      messageEl.hidden = true;
    }
  };

  fileInput.addEventListener('change', () => {
    const [file] = fileInput.files || [];
    updateMessage(file ? file.name : '');
  });

  fileInput.addEventListener('input', () => {
    // Handles browsers that emit `input` when the selection is cleared.
    const [file] = fileInput.files || [];
    if (!file) {
      updateMessage('');
    }
  });
})();
