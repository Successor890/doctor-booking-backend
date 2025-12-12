// generateHash.ts
import bcrypt from "bcrypt";

async function generateHash() {
  const password = "admin123"; // <-- password you want to hash
  const hash = await bcrypt.hash(password, 10); // 10 is salt rounds
  console.log(hash);
}

generateHash();
