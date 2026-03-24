export default function Input({
  className = "",
  ...props
}) {
  return (
    <input
      {...props}
      className={"ea-input " + className}
    />
  );
}
