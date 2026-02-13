import hljs from 'highlight.js';

// Intersection Observer for lazy code highlighting
let observer = null;

/**
 * Initialize the intersection observer for lazy code highlighting
 * Code blocks are highlighted when they come into view (with 100px margin)
 */
export function initLazyHighlighting() {
  if (observer) return;

  if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
    // Fallback for SSR or browsers without IntersectionObserver
    return;
  }

  observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const codeBlock = entry.target;
        if (codeBlock.dataset.needsHighlight === 'true') {
          highlightBlock(codeBlock);
          codeBlock.dataset.needsHighlight = 'false';
          observer.unobserve(codeBlock);
        }
      }
    });
  }, {
    rootMargin: '100px',
    threshold: 0
  });
}

/**
 * Highlight a single code block element
 * @param {HTMLElement} codeElement - The code element to highlight
 */
function highlightBlock(codeElement) {
  if (!codeElement || !codeElement.textContent) return;

  // Extract language from className (e.g., "language-javascript" or "hljs javascript")
  const langMatch = codeElement.className.match(/language-(\w+)/);
  const lang = langMatch ? langMatch[1] : 'text';

  if (lang && lang !== 'text' && hljs.getLanguage(lang)) {
    try {
      const result = hljs.highlight(codeElement.textContent, { language: lang });
      codeElement.innerHTML = result.value;
      codeElement.classList.add('hljs');
    } catch (err) {
      // Silently fail - code will still be displayed, just not highlighted
      console.warn('Failed to highlight code block:', err);
    }
  }
}

/**
 * Observe all code blocks in a container for lazy highlighting
 * @param {HTMLElement} container - The container to search for code blocks
 */
export function observeCodeBlocks(container) {
  if (!container || typeof window === 'undefined') return;

  if (!observer) {
    initLazyHighlighting();
  }

  // Find all code blocks that need highlighting
  const blocks = container.querySelectorAll('code[data-needs-highlight="true"]');
  blocks.forEach(block => {
    if (observer) {
      observer.observe(block);
    } else {
      // Fallback: highlight immediately if no observer
      highlightBlock(block);
      block.dataset.needsHighlight = 'false';
    }
  });
}

/**
 * Highlight all code blocks in a container immediately
 * Use this for completed messages where immediate highlighting is desired
 * @param {HTMLElement} container - The container to search for code blocks
 */
export function highlightAllBlocks(container) {
  if (!container || typeof window === 'undefined') return;

  const blocks = container.querySelectorAll('code[data-needs-highlight="true"]');
  blocks.forEach(block => {
    highlightBlock(block);
    block.dataset.needsHighlight = 'false';
  });
}

/**
 * Clean up the observer when no longer needed
 */
export function cleanupLazyHighlighting() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}
