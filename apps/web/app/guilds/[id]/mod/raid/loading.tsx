import { SkeletonFrame, SkeletonTable } from "../../../../../components/mod/Skeletons";

export default function Loading() {
  return (
    <SkeletonFrame label="Loading the raid tools">
      <SkeletonTable rows={3} columns={4} />
      <SkeletonTable rows={2} columns={2} />
      <SkeletonTable rows={4} columns={3} />
    </SkeletonFrame>
  );
}
