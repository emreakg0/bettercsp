import { useState } from 'react';

// Saved sections and both Rescue preview paths share the same clipboard feedback.
export function RegistrationIndex({ index }: { index: string }) {
  const [feedback, setFeedback] = useState('');
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(index);
      setFeedback('Copied ' + index + '.');
    } catch {
      setFeedback('Could not copy. Select and copy the index above.');
    }
  }
  return <span className="registration-index">Index <strong>{index}</strong>{' '}
    <button type="button" className="text-button" aria-label={`Copy registration index ${index}`} onClick={() => void copy()}>Copy</button>
    <span role="status">{feedback}</span>
  </span>;
}
