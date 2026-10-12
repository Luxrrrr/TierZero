import logo from "./logo.png";

/** The TierZero mark, drawn small next to the wordmark. It is decorative, since the name is always beside it. */
export function Logo() {
  return <img className="mark" src={logo.src} width={24} height={24} alt="" aria-hidden="true" />;
}
