// Related follow-up questions the agent proposes, shown under an answer
// as clickable chips. Clicking one sends it as the next message. The
// list comes from the agent's `suggestions` state (see the agent's
// suggestions.py) - this component only renders and forwards clicks.
export function SuggestedQuestions({
  questions,
  onAsk,
  disabled,
  label = "Related questions",
}: {
  questions: string[];
  onAsk: (question: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  if (!questions || questions.length === 0) return null;
  return (
    <div className="suggestions">
      <div className="suggestions-label">{label}</div>
      <div className="suggestions-chips">
        {questions.map((q, i) => (
          <button
            key={i}
            type="button"
            className="suggestion-chip"
            disabled={disabled}
            onClick={() => onAsk(q)}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
