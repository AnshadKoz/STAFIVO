const fs = require('fs');
const path = require('path');

const checkSnippetAdmin = 
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return { status: 'error', message: 'Unauthorized' };
  
  const { data: roleData } = await supabaseAuth.from('app_users').select('role').eq('auth_id', user.id).single();
  if (roleData?.role !== 'admin') return { status: 'error', message: 'Forbidden: Admins only' };
;

const checkSnippetManager = 
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return { status: 'error', message: 'Unauthorized' };
  
  const { data: roleData } = await supabaseAuth.from('app_users').select('role').eq('auth_id', user.id).single();
  if (roleData?.role !== 'admin' && roleData?.role !== 'manager') return { status: 'error', message: 'Forbidden: Managers only' };
;

function processFile(filePath, roleCheckSnippet) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Find all exported async functions
    const regex = /export async function (\w+)\s*\([^)]*\)\s*(?::\s*Promise<[^>]+>)?\s*\{/g;
    let match;
    let newContent = content;
    let offset = 0;
    
    while ((match = regex.exec(content)) !== null) {
        const functionName = match[1];
        // skip if it already has getUser
        const blockStart = match.index + match[0].length;
        const snippet = content.substring(blockStart, blockStart + 200);
        if (snippet.includes('supabase.auth.getUser') || snippet.includes('supabaseAuth.auth.getUser')) {
            console.log(Skipping  in  - already has auth check);
            continue;
        }
        
        console.log(Patching  in );
        const insertPos = blockStart + offset;
        newContent = newContent.slice(0, insertPos) + roleCheckSnippet + newContent.slice(insertPos);
        offset += roleCheckSnippet.length;
    }
    
    fs.writeFileSync(filePath, newContent, 'utf8');
}

const basePath = path.join(process.cwd(), 'stafivo_web', 'app');
processFile(path.join(basePath, 'admin', 'adminActions.ts'), checkSnippetAdmin);
processFile(path.join(basePath, 'admin', 'payrollActions.ts'), checkSnippetAdmin);
processFile(path.join(basePath, 'manager', 'managerActions.ts'), checkSnippetManager);
processFile(path.join(basePath, 'worker', 'workerActions.ts'), 
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return { status: 'error', message: 'Unauthorized' };
);

console.log("Done patching Server Actions.");
