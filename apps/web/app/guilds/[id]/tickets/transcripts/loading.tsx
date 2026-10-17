import { SkeletonFrame, SkeletonTable, SkeletonToolbar } from "../../../../../components/mod/Skeletons";

export default function Loading() {
  return (
    <SkeletonFrame label="Loading the transcripts">
      <SkeletonToolbar chips={3} />
      <SkeletonTable rows={8} columns={6} />
    </SkeletonFrame>
  );
}
