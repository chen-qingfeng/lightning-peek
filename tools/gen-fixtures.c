/* 生成验证用的合成图纸，不含任何真实项目。GPL-3.0-or-later */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include "dwg.h"
#include "dwg_api.h"

void dwg_set_next_objhandle (Dwg_Object *obj);

static void die (const char *msg, int code)
{
  fprintf (stderr, "%s (%d)\n", msg, code);
  exit (1);
}

static void put_bits (unsigned char **buf, int *nbits, int *cap, unsigned v, int n)
{
  for (int i = n - 1; i >= 0; i--)
    {
      int bit = (v >> i) & 1;
      int byte = *nbits >> 3;
      if (byte >= *cap)
        {
          int ncap = *cap ? *cap * 2 : 64;
          unsigned char *nb = realloc (*buf, ncap);
          if (!nb) die ("内存不足", 0);
          memset (nb + *cap, 0, ncap - *cap);
          *buf = nb;
          *cap = ncap;
        }
      if ((*nbits & 7) == 0) (*buf)[byte] = 0;
      if (bit) (*buf)[byte] |= (unsigned char) (128 >> (*nbits & 7));
      (*nbits)++;
    }
}
static void put_rc (unsigned char **b, int *n, int *c, unsigned v) { put_bits (b, n, c, v & 255, 8); }
static void put_rs (unsigned char **b, int *n, int *c, unsigned v)
{
  put_rc (b, n, c, v & 255);
  put_rc (b, n, c, (v >> 8) & 255);
}
static void put_bs (unsigned char **b, int *n, int *c, unsigned v)
{
  if (v == 0) put_bits (b, n, c, 2, 2);
  else if (v < 256) { put_bits (b, n, c, 1, 2); put_rc (b, n, c, v); }
  else { put_bits (b, n, c, 0, 2); put_rs (b, n, c, v); }
}
static void put_rd (unsigned char **b, int *n, int *c, double v)
{
  unsigned char u[8];
  memcpy (u, &v, 8);
  for (int i = 0; i < 8; i++) put_rc (b, n, c, u[i]);
}
static void put_bd (unsigned char **b, int *n, int *c, double v)
{
  if (v == 0) put_bits (b, n, c, 2, 2);
  else if (v == 1) put_bits (b, n, c, 1, 2);
  else { put_bits (b, n, c, 0, 2); put_rd (b, n, c, v); }
}
static void put_tv (unsigned char **b, int *n, int *c, const unsigned char *s, int len)
{
  put_bs (b, n, c, (unsigned) len);
  for (int i = 0; i < len; i++) put_rc (b, n, c, s[i]);
}

/* 与 test/tarch.test.mjs 里 TCH_TEXT 的位流一致：文字是 GBK「消防」。 */
static void tch_text_bits (unsigned char **out, int *nbytes, int *nbits)
{
  unsigned char *b = NULL;
  int n = 0, cap = 0;
  const unsigned char word[] = { 0xcf, 0xfb, 0xb7, 0xc0, 0x00 };
  put_rc (&b, &n, &cap, 4);
  put_bd (&b, &n, &cap, 100);
  put_bs (&b, &n, &cap, 0);
  put_rs (&b, &n, &cap, 512);
  put_tv (&b, &n, &cap, word, 5);
  put_bd (&b, &n, &cap, 71796.85);
  put_bd (&b, &n, &cap, 25636.74);
  put_bd (&b, &n, &cap, 0);
  put_bd (&b, &n, &cap, 3.5);
  put_bd (&b, &n, &cap, 0);
  put_rs (&b, &n, &cap, 5);
  *out = b;
  *nbits = n;
  *nbytes = (n + 7) / 8;
}

static Dwg_Object_BLOCK_HEADER *model_header (Dwg_Data *dwg)
{
  Dwg_Object *ms = dwg_model_space_object (dwg);
  if (!ms || !ms->tio.object) return NULL;
  return ms->tio.object->tio.BLOCK_HEADER;
}

static int write_lines (const char *path, int count)
{
  Dwg_Data *dwg = dwg_new_Document (R_2000, 0, 0);
  if (!dwg) die ("无法新建图纸", 0);
  dwg->header.from_version = dwg->header.version;
  Dwg_Object_BLOCK_HEADER *hdr = model_header (dwg);
  if (!hdr) die ("没有模型空间", 0);
  for (int i = 0; i < count; i++)
    {
      dwg_point_3d a, b;
      a.x = (double) (i % 1000);
      a.y = (double) (i / 1000);
      a.z = 0;
      b.x = a.x + 1;
      b.y = a.y;
      b.z = 0;
      if (!dwg_add_LINE (hdr, &a, &b)) die ("加直线失败", i);
      if ((i + 1) % 5000 == 0) hdr = model_header (dwg);
    }
  int rc = dwg_write_file (path, dwg);
  dwg_free (dwg);
  return rc;
}

static int write_tarch (const char *path)
{
  Dwg_Data *dwg = dwg_new_Document (R_2000, 0, 0);
  if (!dwg) die ("无法新建图纸", 0);
  dwg->header.from_version = dwg->header.version;
  int cls = dwg_add_class (dwg, "TCH_TEXT", "TDbText", "TCH_DB", 1);
  if (cls < 500) die ("加天正类失败", cls);
  Dwg_Object_BLOCK_HEADER *hdr = model_header (dwg);
  if (!hdr) die ("没有模型空间", 0);
  dwg_point_3d a = { 0, 0, 0 }, b = { 1000, 0, 0 };
  Dwg_Entity_LINE *line = dwg_add_LINE (hdr, &a, &b);
  if (!line || !line->parent) die ("加参照直线失败", 0);
  Dwg_Object *obj = &dwg->object[line->parent->objid];
  unsigned char *bits = NULL;
  int nbytes = 0, nbits = 0;
  tch_text_bits (&bits, &nbytes, &nbits);
  obj->fixedtype = DWG_TYPE_UNKNOWN_ENT;
  obj->type = (BITCODE_BS) cls;
  obj->name = strdup ("UNKNOWN_ENT");
  obj->dxfname = strdup ("TCH_TEXT");
  obj->klass = &dwg->dwg_class[cls - 500];
  obj->klass->num_instances = 1;
  obj->unknown_bits = bits;
  obj->num_unknown_bits = (BITCODE_RL) nbits;
  /* 同一版本才能把 unknown_bits 原样写回去；去掉 DXF/JSON 导入标记，避免被换成 POINT。 */
  dwg->opts &= ~DWG_OPTS_IN;
  dwg->header.from_version = dwg->header.version;
  int rc = dwg_write_file (path, dwg);
  dwg_free (dwg);
  return (rc & 128) ? 1 : 0;
}

int main (int argc, char **argv)
{
  if (argc < 3)
    {
      fprintf (stderr, "用法: gen-fixtures tarch <out.dwg> | lines <条数> <out.dwg>\n");
      return 2;
    }
  if (!strcmp (argv[1], "tarch"))
    return write_tarch (argv[2]) ? 1 : 0;
  if (!strcmp (argv[1], "lines") && argc >= 4)
    return write_lines (argv[3], atoi (argv[2])) ? 1 : 0;
  fprintf (stderr, "未知命令\n");
  return 2;
}
