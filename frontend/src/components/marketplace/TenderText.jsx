export default function TenderText({ children }) {
  return <>{String(children || "").split(/(\*{2,3}[^*]+\*{2,3})/g).map((part, i) => /^\*{2,3}/.test(part)
    ? <strong key={i}>{part.replace(/^\*{2,3}|\*{2,3}$/g, "")}</strong> : part)}</>;
}
