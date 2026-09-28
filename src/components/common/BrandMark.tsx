import { useId, type SVGProps } from "react";

const PAGE_PATH = "M17 8h47v17c0 9 7 16 16 16h16v42c0 8-6 14-14 14H17C9 97 4 91 4 83V22C4 14 9 8 17 8Z";
const FOLD_PATH = "M70 8v17c0 5 4 10 10 10h16L70 8Z";
const MONOGRAM_PATH = "M24 78V28h12l29 34V28h12v50H65L36 44v34H24Z";

export interface BrandMarkProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  size?: number;
  title?: string;
}

/** Approved Concept A: D/N monogram cut from a folded note page. */
export function BrandMark({ size = 20, title, ...props }: BrandMarkProps) {
  const maskId = `dn-fold-${useId().replace(/:/g, "")}`;
  return (
    <svg
      {...props}
      width={size}
      height={size}
      viewBox="0 0 100 104"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      xmlns="http://www.w3.org/2000/svg"
    >
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="104">
        <rect width="100" height="104" fill="white" />
        <path d={MONOGRAM_PATH} fill="black" />
      </mask>
      <g mask={`url(#${maskId})`} fill="currentColor">
        <path d={PAGE_PATH} />
        <path d={FOLD_PATH} />
      </g>
    </svg>
  );
}
