import { SkeletonFrame, SkeletonTable, SkeletonToolbar } from "../../../../../components/mod/Skeletons";

export default function Loading() {
  return (
    <SkeletonFrame label="Loading ban appeals">
      <SkeletonToolbar chips={4} />
      <SkeletonTable rows={8} columns={4} title={false} />
    </SkeletonFrame>
  );
}
