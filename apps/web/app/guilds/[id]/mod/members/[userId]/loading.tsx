import { SkeletonFrame, SkeletonProfile } from "../../../../../../components/mod/Skeletons";

export default function Loading() {
  return (
    <SkeletonFrame label="Loading member record">
      <SkeletonProfile />
    </SkeletonFrame>
  );
}
