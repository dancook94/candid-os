import { revalidatePath } from "next/cache";

export function revalidateStaffAvatarSurfaces() {
  revalidatePath("/", "layout");
  revalidatePath("/staff");
  revalidatePath("/staff/profile");
  revalidatePath("/admin");
  revalidatePath("/admin/staff");
}
