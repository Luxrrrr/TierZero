import { SkeletonFrame, SkeletonTable } from "../../../../../components/mod/Skeletons";

export default function Loading() {
  return (
    <SkeletonFrame label="Loading staff access">
      <SkeletonTable rows={2} columns={2} />
      <SkeletonTable rows={6} columns={3} />
    </SkeletonFrame>
  );
}
