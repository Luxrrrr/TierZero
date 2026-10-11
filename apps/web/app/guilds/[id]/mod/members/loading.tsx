import { SkeletonFrame, SkeletonTable, SkeletonToolbar } from "../../../../../components/mod/Skeletons";

export default function Loading() {
  return (
    <SkeletonFrame label="Loading members">
      <SkeletonToolbar chips={4} />
      <SkeletonTable rows={10} columns={5} title={false} />
    </SkeletonFrame>
  );
}
